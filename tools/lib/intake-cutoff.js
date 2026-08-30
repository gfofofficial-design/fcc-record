// BUILD 04.1 — INTAKE CUTOFF COMPUTATION.
//
// Implements EXACTLY the frozen formula from FCC_STAGE0_CANDIDATE_SELECTION_METHOD_V0_2.md
// §2 Step 0 (final, C-3-corrected):
//
//   CUTOFF_TIMESTAMP = 00:00:00 UTC exactly 2 calendar days after the LATER of:
//     1. BUILD 03.1 AD-3 status becoming VERIFIED; and
//     2. Candidate Selection Method v0.2 ratification being recorded.
//
// The trigger set is permanently closed (per the final C-3 correction) -- this module
// has NO parameter, option, or code path to add a third condition, override the buffer,
// or otherwise move the computed timestamp. Nothing here can substitute a different
// cutoff when a condition is unmet; it can only report that the cutoff is UNDEFINED.
const fs = require('fs');
const path = require('path');

const CUTOFF_BUFFER_DAYS = 2; // frozen, per the ratified methodology -- not a parameter

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function readAd3Status(repoRoot) {
  // The v1 record (build03-1-ad3-status.json) is immutable under the repository
  // append-only law (non-ndjson file under governance/gates/), and its own note
  // defines the sanctioned update path: a NEW, separately-versioned file plus its
  // own adjudication gate. Candidate Selection Method v0.2 §2 Step 0 condition 1
  // is defined on the AD-3 gate's "own governance record", so this reader resolves
  // the HIGHEST-versioned record in that lineage (build03-1-ad3-status.json = v1,
  // build03-1-ad3-status.v2.json, .v3.json, ...). This changes only WHICH record
  // in the gate's lineage is read; the frozen cutoff formula above is untouched.
  const dir = path.join(repoRoot, 'governance', 'gates');
  if (!fs.existsSync(dir)) return { status: 'MISSING', verified_at: null };
  const lineage = /^build03-1-ad3-status(?:\.v(\d+))?\.json$/;
  let bestFile = null;
  let bestVersion = -1;
  for (const f of fs.readdirSync(dir)) {
    const m = lineage.exec(f);
    if (!m) continue;
    const v = m[1] ? parseInt(m[1], 10) : 1;
    if (v > bestVersion) { bestVersion = v; bestFile = f; }
  }
  if (!bestFile) return { status: 'MISSING', verified_at: null };
  return readJson(path.join(dir, bestFile));
}
function readRatificationRecord(repoRoot) {
  const p = path.join(repoRoot, 'governance', 'experiments', 'stage0-public-experiment-v1', 'candidate-selection-ratification.json');
  if (!fs.existsSync(p)) return { ratified: false, ratified_at: null };
  return readJson(p);
}

// Pure: given the two condition states, compute cutoff status. No I/O, no clock reads
// except the injected `nowMs` for "has the cutoff passed" evaluation.
function computeCutoff({ ad3Status, ratification }, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const cond1Met = ad3Status && ad3Status.status === 'VERIFIED' && !!ad3Status.verified_at;
  const cond2Met = ratification && ratification.ratified === true && !!ratification.ratified_at;

  if (!cond1Met || !cond2Met) {
    const unmet = [];
    if (!cond1Met) unmet.push('AD-3 (BUILD 03.1) not VERIFIED');
    if (!cond2Met) unmet.push('Candidate Selection Method v0.2 ratification record missing/incomplete');
    return {
      defined: false,
      authorized: false,
      reason: `CUTOFF UNDEFINED — trigger condition(s) unmet: ${unmet.join('; ')}. No cutoff timestamp exists until BOTH conditions are met; nothing in this system may substitute, guess, or provisionally assume a cutoff.`,
      unmetConditions: unmet,
    };
  }

  const t1 = Date.parse(ad3Status.verified_at + (ad3Status.verified_at.length === 10 ? 'T00:00:00Z' : ''));
  const t2 = Date.parse(ratification.ratified_at + (ratification.ratified_at.length === 10 ? 'T00:00:00Z' : ''));
  const laterMs = Math.max(t1, t2);
  const laterDate = new Date(laterMs);
  // 00:00:00 UTC exactly CUTOFF_BUFFER_DAYS after the later condition's calendar day.
  const cutoffDate = new Date(Date.UTC(laterDate.getUTCFullYear(), laterDate.getUTCMonth(), laterDate.getUTCDate() + CUTOFF_BUFFER_DAYS, 0, 0, 0));
  const cutoffMs = cutoffDate.getTime();
  const reached = now >= cutoffMs;

  return {
    defined: true,
    cutoffTimestamp: cutoffDate.toISOString(),
    laterConditionTimestamp: laterDate.toISOString(),
    laterConditionWas: t1 >= t2 ? 'AD-3 VERIFIED' : 'methodology ratification',
    reached,
    authorized: reached, // authorized to run intake ONLY once the frozen cutoff has actually arrived
    reason: reached
      ? `Cutoff ${cutoffDate.toISOString()} has been reached — intake execution is authorized (subject to INTAKE_BLOCKED checks elsewhere).`
      : `Cutoff computed as ${cutoffDate.toISOString()} but has NOT yet been reached (now=${new Date(now).toISOString()}) — intake execution is NOT authorized.`,
  };
}

// Convenience: read real repo state and compute.
function computeCutoffFromRepo(repoRoot, nowMs) {
  const ad3Status = readAd3Status(repoRoot);
  const ratification = readRatificationRecord(repoRoot);
  return computeCutoff({ ad3Status, ratification }, nowMs);
}

module.exports = { CUTOFF_BUFFER_DAYS, readAd3Status, readRatificationRecord, computeCutoff, computeCutoffFromRepo };
