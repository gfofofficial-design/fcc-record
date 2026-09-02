#!/usr/bin/env node
// FCC STAGE 0 — CI INTAKE GUARD.
//
// Replaces the raw CI invocation `node tools/run-candidate-intake.js || test $? -eq 2`,
// which was written while AD-3 was UNRESOLVED and therefore assumed the cutoff
// could never be reached. This guard preserves every property of that check and
// adds the post-cutoff truth:
//
//   A. BEFORE the frozen cutoff — the intake runner MUST refuse. The guard
//      actually invokes it and requires exit 2 (INTAKE_NOT_AUTHORIZED).
//   B. AFTER the cutoff, prerequisites absent or intake simply not executed —
//      the guard NEVER invokes the runner. Time passing must never cause
//      intake. It instead verifies the candidate slate is still untouched
//      (byte-hash vs the frozen Experiment Freeze reference) and reports that
//      execution remains gated on a separately authorized execution record.
//   C. AFTER the cutoff with the slate populated — lawful ONLY if an explicit
//      intake-execution authorization record exists under governance/gates/.
//      Absent one, the guard fails the build (fail closed).
//
// The frozen cutoff formula and the runner's own unconditional gate are both
// untouched — this guard only decides what CI checks, never what intake does.
'use strict';
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { computeCutoffFromRepo } = require('./lib/intake-cutoff.js');

const ROOT = path.join(__dirname, '..');
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// Pure decision core — covered directly by tests for all three cases, so the
// post-cutoff branches are proven BEFORE the cutoff ever arrives.
function guardDecision({ authorized, runnerExit, slateShaNow, frozenSlateSha, slatePopulated, authRecordPresent }) {
  if (!authorized) {
    return runnerExit === 2
      ? { pass: true, caseId: 'A', why: 'before cutoff, intake runner refused with exit 2 as required' }
      : { pass: false, caseId: 'A', why: `before cutoff the runner must refuse with exit 2, got exit ${runnerExit}` };
  }
  if (slateShaNow === frozenSlateSha && slatePopulated === false) {
    return { pass: true, caseId: 'B', why: 'cutoff reached; intake ELIGIBLE but CI never executes it; slate byte-identical to the frozen reference; execution requires a separately authorized gate record' };
  }
  return authRecordPresent
    ? { pass: true, caseId: 'C', why: 'slate changed under an explicit intake-execution authorization record' }
    : { pass: false, caseId: 'C', why: 'fail-closed: slate no longer matches the frozen reference and no intake-execution authorization record exists' };
}
module.exports = { guardDecision };

if (require.main !== module) return;

const cutoff = computeCutoffFromRepo(ROOT);
console.log('=== CI INTAKE GUARD ===');
console.log(JSON.stringify(cutoff, null, 2));

let runnerExit = null;
if (!cutoff.authorized) {
  // Case A — the ONLY branch that ever invokes the runner, and only to prove refusal.
  const r = spawnSync(process.execPath, [path.join(__dirname, 'run-candidate-intake.js')], { encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  runnerExit = r.status;
}
const slatePath = path.join(ROOT, 'governance', 'experiments', 'stage0-public-experiment-v1', 'candidate-slate.json');
const freeze = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance', 'experiments', 'stage0-public-experiment-v1', 'experiment-freeze.json'), 'utf8'));
const gatesDir = path.join(ROOT, 'governance', 'gates');
const authRecordPresent = !!fs.readdirSync(gatesDir).filter((f) => /^intake-execution-.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(gatesDir, f), 'utf8'))).find((r) => r.authorized === true && r.gate === 'CANDIDATE_INTAKE_EXECUTION');
const decision = guardDecision({
  authorized: cutoff.authorized,
  runnerExit,
  slateShaNow: sha256(slatePath),
  frozenSlateSha: freeze.candidate_slate_ref && freeze.candidate_slate_ref.sha256,
  slatePopulated: JSON.parse(fs.readFileSync(slatePath, 'utf8')).all_slots_populated,
  authRecordPresent,
});
console.log(`GUARD CASE ${decision.caseId}: ${decision.pass ? 'PASS' : 'FAIL'} — ${decision.why}`);

// ---- EPOCH 2 / v0.3 GUARD (additive) ------------------------------------
// The whole E2 decision lives in tools/lib/epoch2-intake-authorization.js
// (decideEpoch2GuardCase) so the dedicated suite tests the SAME production
// logic this guard runs. CI evaluates any intake-execution-002.json UNSUPERVISED
// and passes only if the refusal reasons are exclusively lawful pre-execution
// ones (P1 pre-cutoff, M supervised, R readiness); any integrity failure,
// malformed/renamed-draft/conflicting record, or gate exception fails CI.
// CI itself never executes an intake.
const { decideEpoch2GuardCase } = require('./lib/epoch2-intake-authorization.js');
const e2d = decideEpoch2GuardCase(ROOT);
console.log(`GUARD CASE ${e2d.caseId}: ${e2d.pass ? 'PASS' : 'FAIL'} — ${e2d.why}`);
process.exit(decision.pass && e2d.pass ? 0 : 1);
