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

// ============================================================================
// EPOCH 2 / v0.3 LINEAGE — EPOCH2_CUTOFF_RULE_CANONICAL_V03 (additive; the
// v0.2 functions above are UNCHANGED and remain the historical Epoch 1
// reconstruction path — they are NOT valid inputs for Epoch 2).
//
// Formula (identical arithmetic, re-bound inputs — frozen; no parameter,
// override, environment variable, or third trigger can move it):
//   CUTOFF_TIMESTAMP = 00:00:00 UTC exactly 2 calendar days after the LATER of:
//     (1) AD-3 VERIFIED  — governance/gates/build03-1-ad3-status lineage, verified_at
//     (2) v0.3 ratification — candidate-selection-ratification.v2.json, TOP-LEVEL ratified_at
//
// Clarification handling (v03-ratification-input2-clarification-001.json):
// this resolver NEVER reads cutoff_rule.input_2.value / .state — the ratified
// record's own cutoff_rule.prerequisite_vs_temporal_input already defines the
// top-level ratified_at as the SOLE temporal input of (2), and the recorded
// clarification classifies those nested fields as
// STALE_PRE_RECORDING_DESCRIPTIVE_FIELDS with no authority. Structural
// ignorance of the stale fields (proven by tests with poisoned fixtures) is
// narrower and more robust than parsing the clarification at runtime.
const RATIFIED_AT_V2_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/; // full UTC with seconds; date-only NOT accepted for v2

function readRatificationRecordV2(repoRoot) {
  const p = path.join(repoRoot, 'governance', 'experiments', 'stage0-public-experiment-v1', 'candidate-selection-ratification.v2.json');
  if (!fs.existsSync(p)) return { exists: false, ratified: false, ratified_at: null };
  const raw = readJson(p);
  // TOP-LEVEL fields only. Nested cutoff_rule.input_2.* is deliberately not read.
  return { exists: true, ratified: raw.ratified === true, ratified_at: typeof raw.ratified_at === 'string' ? raw.ratified_at : null };
}

// Pure. No clock reads except injected nowMs for "reached" evaluation.
function computeEpoch2Cutoff({ ad3Status, ratificationV2 }, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const failures = [];
  const cond1Met = !!(ad3Status && ad3Status.status === 'VERIFIED' && ad3Status.verified_at);
  if (!cond1Met) failures.push('AD-3 (BUILD 03.1) not VERIFIED / verified_at missing');
  const r = ratificationV2 || {};
  if (!r.exists) failures.push('candidate-selection-ratification.v2.json missing — v1 ratification is NOT a substitute for Epoch 2');
  else if (r.ratified !== true) failures.push('ratification.v2 present but ratified !== true');
  else if (!r.ratified_at || !RATIFIED_AT_V2_RE.test(r.ratified_at) || Number.isNaN(Date.parse(r.ratified_at)))
    failures.push('ratification.v2 ratified_at missing/malformed — full ISO-8601 UTC with seconds (YYYY-MM-DDTHH:MM:SSZ) is required for v2; date-only is not accepted');
  if (failures.length) {
    return { ruleId: 'EPOCH2_CUTOFF_RULE_CANONICAL_V03', defined: false, reached: false, epoch2IntakeAuthorized: false,
      reason: 'EPOCH 2 CUTOFF UNDEFINED — ' + failures.join('; ') + '. Nothing may substitute, guess, or provisionally assume a cutoff.',
      unmetConditions: failures };
  }
  const t1 = Date.parse(ad3Status.verified_at + (ad3Status.verified_at.length === 10 ? 'T00:00:00Z' : ''));
  const t2 = Date.parse(r.ratified_at); // full-UTC enforced above; no date-only branch for v2
  const laterMs = Math.max(t1, t2);
  const laterDate = new Date(laterMs);
  const cutoffDate = new Date(Date.UTC(laterDate.getUTCFullYear(), laterDate.getUTCMonth(), laterDate.getUTCDate() + CUTOFF_BUFFER_DAYS, 0, 0, 0));
  const reached = now >= cutoffDate.getTime();
  return {
    ruleId: 'EPOCH2_CUTOFF_RULE_CANONICAL_V03',
    defined: true,
    cutoffTimestamp: cutoffDate.toISOString(),
    laterConditionTimestamp: laterDate.toISOString(),
    laterConditionWas: t1 >= t2 ? 'AD-3 VERIFIED' : 'v0.3 ratification (ratified_at)',
    reached,
    // CUTOFF COMPUTABILITY / ARRIVAL DOES NOT EQUAL EXPERIMENT ACTIVATION.
    // Epoch 2 intake additionally requires experiment-freeze.v2, candidate-slate.v2,
    // methodology-supersession, intake-execution-002 and every other frozen gate,
    // machine-verified by a v2 authorization gate module that does not exist yet.
    epoch2IntakeAuthorized: false,
    epoch2AuthorizationNote: 'HARD-BLOCKED here: cutoff reached does NOT authorize intake; a separate v2 authorization gate (freeze.v2 + slate.v2 + supersession + intake-execution-002 verification) is required and is not yet implemented.',
    reason: reached
      ? `Epoch 2 cutoff ${cutoffDate.toISOString()} reached — discovery/intake remain NOT AUTHORIZED pending the separate v2 gates.`
      : `Epoch 2 cutoff computed as ${cutoffDate.toISOString()} — not yet reached (now=${new Date(now).toISOString()}).`,
  };
}

function computeEpoch2CutoffFromRepo(repoRoot, nowMs) {
  return computeEpoch2Cutoff({ ad3Status: readAd3Status(repoRoot), ratificationV2: readRatificationRecordV2(repoRoot) }, nowMs);
}

module.exports = { CUTOFF_BUFFER_DAYS, readAd3Status, readRatificationRecord, computeCutoff, computeCutoffFromRepo,
  RATIFIED_AT_V2_RE, readRatificationRecordV2, computeEpoch2Cutoff, computeEpoch2CutoffFromRepo };
