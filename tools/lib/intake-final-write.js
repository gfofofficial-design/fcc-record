// FCC STAGE 0 — FINAL SUPERVISED WRITE TRANSACTION (IMPLEMENTED, NOT EXECUTABLE AGAINST THE REPO).
//
// ARCHITECTURE DECISION REQUIRED — DISCLOSED, NOT IMPROVISED:
// candidate-slate.json and experiment-freeze.json live under governance/experiments/,
// a PROTECTED ROOT of the append-only law (tools/lib/append-only-law.js): every
// non-ndjson file there is immutable, and correction records can only bless
// byte-exact restorations. An in-place slate write is therefore a permanent
// append-only violation, and the Experiment Freeze pins the placeholder slate's
// hash (candidate_slate_ref) with freeze_status BLOCKED whose reason text
// requires a populated slate AND frozen calendar dates before VALID.
// The lawful pattern already in this architecture is versioned supersession
// (build03-1-ad3-status.v2.json), which would require NEW ratified rules for:
//   (a) candidate-slate.vN.json / experiment-freeze.vN.json lineage,
//   (b) freeze-verifier, ci-intake-guard and authorization precondition-D
//       semantics under that lineage,
//   (c) the freeze_status transition when candidates exist but dates do not.
// Until the owner records that decision, executeFinalWrite() REFUSES.
//
// The transaction core below is pure over an injected filesystem-like target
// so its fail-closed ordering is proven by tests now (J, K, L, M in the wiring
// suite): pre-hash check -> slate write -> post-verification -> completion
// marker; slate failure => no marker; marker failure after a verified write =>
// RECONCILIATION_REQUIRED surfaced, never a silent rerun.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function buildSlateDocument(baseSlate, selectedByBucket, { cutoffTimestamp, authorizationId }) {
  const slots = JSON.parse(JSON.stringify(baseSlate.slots));
  const order = { short: 0, medium: 0, long: 0 };
  const byBucket = { short: slots.filter((s) => s.horizon_bucket === 'short'), medium: slots.filter((s) => s.horizon_bucket === 'medium'), long: slots.filter((s) => s.horizon_bucket === 'long') };
  for (const bucket of ['short', 'medium', 'long']) {
    for (const cand of selectedByBucket[bucket] || []) {
      const slot = byBucket[bucket][order[bucket]++];
      if (!slot) throw new Error(`slate overflow in bucket ${bucket}`);
      slot.status = 'CANDIDATE_SELECTED';
      slot.subject = { sourceId: cand.sourceId, canonicalId: cand.canonicalId, title: cand.title || null, resolutionDate: cand.resolutionDate };
      slot.primary_source = cand.sourceId;
      slot.note = `Selected mechanically under Candidate Selection Method v0.2 at cutoff ${cutoffTimestamp} under ${authorizationId}. Instrument drafting, LINT, benchmark and adversary fields are later steps.`;
    }
  }
  const populated = slots.every((s) => s.status === 'CANDIDATE_SELECTED');
  return { ...baseSlate, all_slots_populated: populated, slots };
}

// Pure transaction over a target { readSlate(), writeSlate(buf), verifySlate(buf), writeMarker(obj), markerExists() }.
function runFinalWriteTransaction({ target, expectedPreHash, newSlateDocument, authorizationId, nowIso }) {
  const steps = [];
  const pre = target.readSlate();
  if (sha256(pre) !== expectedPreHash) return { ok: false, state: 'REFUSED_PRE_HASH_DRIFT', steps: [`pre-hash ${sha256(pre).slice(0, 12)} != expected ${expectedPreHash.slice(0, 12)}`] };
  if (target.markerExists()) return { ok: false, state: 'REFUSED_ALREADY_COMPLETED', steps: ['completion marker already exists — authorization spent'] };
  const buf = Buffer.from(JSON.stringify(newSlateDocument, null, 2) + '\n');
  try { target.writeSlate(buf); steps.push('slate written'); }
  catch (e) { return { ok: false, state: 'SLATE_WRITE_FAILED_NO_MARKER', steps: steps.concat(['slate write failed: ' + e.message, 'completion marker NOT created']) }; }
  const v = target.verifySlate(buf);
  if (!v.ok) return { ok: false, state: 'SLATE_VERIFICATION_FAILED_NO_MARKER', steps: steps.concat(['post-write verification failed: ' + v.reason, 'completion marker NOT created']) };
  steps.push('slate verified');
  const marker = { artifact_class: 'GOVERNANCE_EXECUTION_COMPLETION', not_a_capital_instrument: true, gate: 'CANDIDATE_INTAKE_EXECUTION', authorization_id: authorizationId, completed_at: nowIso, slate_sha256_after_write: sha256(buf), single_use_consumed: true };
  try { target.writeMarker(marker); steps.push('completion marker written'); }
  catch (e) { return { ok: false, state: 'RECONCILIATION_REQUIRED', steps: steps.concat(['completion marker write failed AFTER a verified slate write: ' + e.message, 'DO NOT rerun intake; owner must reconcile by recording the marker from the verified slate hash ' + sha256(buf)]), slateSha256: sha256(buf) };
  }
  return { ok: true, state: 'COMPLETED', steps, slateSha256: sha256(buf), marker };
}

// Real-repo entry — FAIL CLOSED until the architecture decision is recorded.
function executeFinalWrite() {
  const err = new Error('ARCHITECTURE_DECISION_REQUIRED: an in-place write to governance/experiments/stage0-public-experiment-v1/candidate-slate.json (and the experiment-freeze candidate_slate_ref it invalidates) violates the append-only law for protected roots. A ratified versioned-supersession rule for the slate/freeze lineage (and matching guard/verifier/precondition semantics) must be recorded before any final write. Nothing was written.');
  err.code = 'ARCHITECTURE_DECISION_REQUIRED';
  throw err;
}

// Filesystem target factory for tests (temp dirs only; the real repo path is never passed by any caller).
function fsTarget(dir, { failSlateWrite = false, failMarkerWrite = false, verifier = null } = {}) {
  const slatePath = path.join(dir, 'candidate-slate.json');
  const markerPath = path.join(dir, 'intake-execution-001.completed.json');
  return {
    readSlate: () => fs.readFileSync(slatePath),
    writeSlate: (buf) => { if (failSlateWrite) throw new Error('simulated disk failure'); fs.writeFileSync(slatePath, buf); },
    verifySlate: (buf) => { try { const j = JSON.parse(buf.toString('utf8')); if (verifier) return verifier(j); return j.slots && j.slots.length === 15 ? { ok: true } : { ok: false, reason: 'slot count != 15' }; } catch (e) { return { ok: false, reason: e.message }; } },
    writeMarker: (obj) => { if (failMarkerWrite) throw new Error('simulated marker failure'); fs.writeFileSync(markerPath, JSON.stringify(obj, null, 2) + '\n'); },
    markerExists: () => fs.existsSync(markerPath),
  };
}

// ============================================================================
// EPOCH 2 (v0.3) FINAL-WRITE TARGET — VERSIONED SUPERSESSION, NEVER IN-PLACE.
// The architecture decision demanded above is now recorded law for Epoch 2:
// candidate-slate.v2.json is the IMMUTABLE pre-intake empty shell (its hash is
// pinned by experiment-freeze.v2 and by intake-execution-002). The one
// authorized supervised execution writes a NEW append-only artifact instead of
// ever touching the shell:
const EPOCH2_SELECTED_SLATE_PATH = 'governance/experiments/stage0-public-experiment-v1/candidate-slate.v2.selected.json';
// TARGET-AVAILABILITY PROBE ONLY (REV3 / MV-4, option B — the narrower safe form).
// This function answers exactly one question: is the canonical Epoch 2 output path
// currently free and is the immutable shell still pristine? It is NOT a final-write
// authorization and can never be read as one: its result carries no `allowed` key,
// carries `isFinalWriteAuthorization: false`, and takes no proposed document,
// authorization, cutoff or schema — because no executable v2 writer exists yet.
// Before any future v2 write can be lawful, a separate recorded writer pass must
// machine-verify: exact canonical output path; target absent; pristine shell
// unchanged; final intake-002 valid and hash-bound; cutoff exact; authorization ID
// exact; Method/Spec/freeze/supersession pins; exactly 15 unique slots, every slot
// selected, no duplicate slot identifiers; H1/H2/H3 + S1/S2/S3 controls; schema
// validation against the RECORDED selected-slate schema; post-write byte re-read +
// hash verification; and a completion marker written only after that verification.
function checkEpoch2FinalWriteTargetAvailability(repoRoot, expectedShellSha) {
  const problems = [];
  const target = path.join(repoRoot, EPOCH2_SELECTED_SLATE_PATH);
  if (fs.existsSync(target)) problems.push('candidate-slate.v2.selected.json already exists — write-once; no second population');
  const shell = path.join(repoRoot, 'governance', 'experiments', 'stage0-public-experiment-v1', 'candidate-slate.v2.json');
  if (!fs.existsSync(shell)) problems.push('pre-intake shell candidate-slate.v2.json missing');
  else if (!/^[0-9a-f]{64}$/.test(expectedShellSha || '')) problems.push('expectedShellSha must be the pinned 64-hex shell hash');
  else if (sha256(fs.readFileSync(shell)) !== expectedShellSha) problems.push('pre-intake shell has DRIFTED from its pinned hash');
  return { isFinalWriteAuthorization: false, targetAvailable: problems.length === 0, problems, targetPath: EPOCH2_SELECTED_SLATE_PATH, note: 'availability probe only — never an authorization to write' };
}
// NOTE: no v2 writer is wired here. executeFinalWrite() continues to REFUSE for
// the v1 in-place path, and Epoch 2 write wiring is a later task that may only
// land after the authorization gate is recorded, intake-execution-002 exists and
// the selected-slate schema is recorded.

module.exports = { buildSlateDocument, runFinalWriteTransaction, executeFinalWrite, fsTarget, sha256, EPOCH2_SELECTED_SLATE_PATH, checkEpoch2FinalWriteTargetAvailability };
