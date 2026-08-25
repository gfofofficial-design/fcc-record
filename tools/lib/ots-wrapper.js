// BUILD 03 — OTS APPEND-ONLY PROOF-VERSION WRAPPER + ANCHOR CLASSIFIER.
//
// Frozen resolution (BUILD 03 architecture §6, derived from Arch §5 +
// append-only law, no amendment): successive proof states are successive
// IMMUTABLE FILES — ots/{seq}-{state}-{ulid}.ots. "The upgraded proof file
// is committed" = committed as a NEW file; "all proofs retained" + the
// proven append-only law (existing .ots modify/delete REJECTED) forbid the
// overwrite reading. Upgrade runs on a COPY; the original is never touched.
//
// HARD PROHIBITION (this pass): no real OTS submission. The production
// stamping entry point throws. Fixtures use scripted proof bytes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function otsDir(instrumentDir) { return path.join(instrumentDir, 'ots'); }
function proofFilename(seq, state, ulid) {
  if (!['pending', 'upgraded'].includes(state)) throw new Error(`illegal proof state ${state}`);
  return `${String(seq).padStart(3, '0')}-${state}-${ulid}.ots`;
}
function listProofs(instrumentDir) {
  const d = otsDir(instrumentDir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => f.endsWith('.ots')).sort();
}
function nextSeq(instrumentDir) {
  const seqs = listProofs(instrumentDir).map((f) => parseInt(f.slice(0, 3), 10)).filter((n) => !Number.isNaN(n));
  return seqs.length ? Math.max(...seqs) + 1 : 1;
}
// Append-only write: refuses to overwrite ANY existing path; never modifies.
function writeProofFile(instrumentDir, filename, bytes) {
  const d = otsDir(instrumentDir);
  fs.mkdirSync(d, { recursive: true });
  const target = path.join(d, filename);
  if (fs.existsSync(target)) throw new Error(`OTS append-only violation: ${filename} already exists — proof files are immutable and never overwritten`);
  fs.writeFileSync(target, bytes, { flag: 'wx' }); // wx: fail if exists (race-safe)
  return target;
}
// New anchor attempt (a stamp or re-anchor over the SAME bytes) -> new seq, pending file.
function writePendingProof(instrumentDir, proofBytes, ulidGen) {
  const seq = nextSeq(instrumentDir);
  const name = proofFilename(seq, 'pending', ulidGen());
  return { path: writeProofFile(instrumentDir, name, proofBytes), filename: name, seq };
}
// Upgrade: NEW file at the same seq; the pending original is asserted untouched.
function writeUpgradedProof(instrumentDir, pendingFilename, upgradedBytes, ulidGen) {
  const pendingPath = path.join(otsDir(instrumentDir), pendingFilename);
  if (!fs.existsSync(pendingPath)) throw new Error(`upgrade: pending proof ${pendingFilename} not found`);
  const before = crypto.createHash('sha256').update(fs.readFileSync(pendingPath)).digest('hex');
  const seq = pendingFilename.slice(0, 3);
  const name = `${seq}-upgraded-${ulidGen()}.ots`;
  const out = writeProofFile(instrumentDir, name, upgradedBytes);
  const after = crypto.createHash('sha256').update(fs.readFileSync(pendingPath)).digest('hex');
  if (before !== after) throw new Error('upgrade: pending proof bytes changed during upgrade — append-only law violated');
  return { path: out, filename: name };
}

// Anchor attempt classifier (frozen Clarification 2, mechanical):
// evidence = { requestedAtSameRun: bool, wellFormed: bool,
//              calendars: [{url, accepted}], toolingError: string|null,
//              bitcoinAttestation: {anchorBlocktime}|null }
// -> CONFIRMED | SUBMITTED_PENDING (cause-B territory: no violation from delay)
//    | FCC_ATTRIBUTABLE_FAILURE (cause A: conduct-class violation capable,
//      PROCESS=VIOLATED capable, corrections treatment)
function classifyAnchorAttempt(evidence) {
  if (evidence.bitcoinAttestation && evidence.bitcoinAttestation.anchorBlocktime) {
    return { class: 'CONFIRMED', anchorBlocktime: evidence.bitcoinAttestation.anchorBlocktime };
  }
  const accepted = (evidence.calendars || []).some((c) => c.accepted);
  if (evidence.requestedAtSameRun && evidence.wellFormed && accepted && !evidence.toolingError) {
    return { class: 'SUBMITTED_PENDING', causeIfDelayed: 'B', violation: false, reason: 'well-formed timely submission accepted by >=1 calendar; any confirmation delay is external (cause B, no violation)' };
  }
  return { class: 'FCC_ATTRIBUTABLE_FAILURE', cause: 'A', violation: 'CAPABLE', correctionsTreatment: true, reason: evidence.toolingError ? `tooling/config/operator failure: ${evidence.toolingError}` : (!evidence.requestedAtSameRun ? 'submission not made in the lock pipeline run (untimely)' : !evidence.wellFormed ? 'submission malformed — could not have succeeded' : 'no calendar accepted a submission attributable to FCC-side defect') };
}

// TERMINAL ANCHOR GATE (frozen: the resolution engine refuses TERMINAL while
// required anchor conditions are unmet). The resolution engine is out of
// BUILD 03 scope; this gate function is the unavoidable precondition any
// future terminal transition must call. Requires a verified anchor-confirmed
// event with anchor_blocktime in the instrument's chain.
function assertTerminalPermitted(events) {
  const confirmed = events.find((e) => e.type === 'anchor-confirmed' && e.payload && e.payload.anchor_blocktime);
  if (!confirmed) {
    const err = new Error('TERMINAL_BLOCKED_BY_ANCHOR: no confirmed anchor (anchor-confirmed event with anchor_blocktime) exists for this instrument. TERMINAL remains blocked per frozen Spec 3.5 — pending for days or weeks changes nothing.');
    err.code = 'TERMINAL_BLOCKED_BY_ANCHOR';
    throw err;
  }
  return { permitted: true, anchor_blocktime: confirmed.payload.anchor_blocktime };
}

// Verifier correspondence: proof <-> lock_sha256 = recompute the file hash.
function verifyProofCorrespondence(lockedBytes, lockSha256) {
  return crypto.createHash('sha256').update(lockedBytes).digest('hex') === lockSha256;
}

// PRODUCTION STAMPING: STRUCTURALLY PROHIBITED THIS PASS.
function productionOtsStamp() {
  throw new Error('OTS_SUBMISSION_NOT_AUTHORIZED: real OpenTimestamps submission is prohibited in BUILD 03 (implementation pass).');
}

module.exports = {
  otsDir, proofFilename, listProofs, nextSeq, writeProofFile,
  writePendingProof, writeUpgradedProof, classifyAnchorAttempt,
  assertTerminalPermitted, verifyProofCorrespondence, productionOtsStamp,
};
