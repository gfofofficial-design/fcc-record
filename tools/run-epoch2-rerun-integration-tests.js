#!/usr/bin/env node
// Infrastructure-only C1-C3 integration and adversarial tests.
// No network, no production writes, and no real governance authority.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const canonicalize = require('canonicalize');
const selection = require('./lib/epoch2-selection.js');
const selected = require('./lib/epoch2-rerun-selected-result.js');
const shortage = require('./lib/epoch2-shortage-result.js');
const completion = require('./lib/epoch2-rerun-completion.js');
const gate = require('./lib/epoch2-rerun-authorization.js');
const readiness = require('./lib/epoch2-rerun-readiness-probe.js');
const c0gate = require('./lib/epoch2-intake-authorization.js');
const ciGuard = require('./ci-epoch2-rerun-guard.js');
const runner = require('./run-epoch2-rerun-intake.js');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (condition, name) => { console.log((condition ? 'PASS ' : 'FAIL ') + name); condition ? pass++ : fail++; };
const C1 = completion.CHECKPOINTS.C1.timestamp;
const item = (id, days, sourceId, materialRisk = false) => ({
  sourceId,
  canonicalId: id,
  openedAt: '2026-09-08T00:00:00.000Z',
  resolutionDate: new Date(Date.parse(C1) + days * 86400000).toISOString(),
  observableType: 'OBS_SOURCE_NATIVE_DATE',
  assetId: id,
  title: `Candidate ${id}`,
  qualificationStanceShaped: true,
  subjectTouchesFederation: false,
  materialRisk,
  possibleDuplicateRefs: [],
});

console.log('== run-aware selected result ==');
const pool = [];
for (let i = 0; i < 5; i++) pool.push(item(`a-${i}`, 3 + i, 'A1', i < 3));
for (let i = 0; i < 5; i++) pool.push(item(`b-${i}`, 20 + i, 'B2'));
for (let i = 0; i < 5; i++) pool.push(item(`e-${i}`, 50 + i, 'E1'));
const result = selection.selectEpoch2(pool, { cutoff: C1 });
const authorizationBytes = Buffer.from('fixture-auth-003');
const reconciliationBytes = Buffer.from('fixture-c0-reconciliation');
const shellBytes = Buffer.from('fixture-shell');
const lineage = { methodology: 'a'.repeat(64), experiment_spec: 'b'.repeat(64), experiment_freeze: 'c'.repeat(64), supersession_record: 'd'.repeat(64) };
const completedAt = '2026-09-10T00:05:00Z';
const document = selected.buildSelectedSlate({ run: 'C1', result, authorizationSha: selected.sha256(authorizationBytes), reconciliationSha: selected.sha256(reconciliationBytes), shellSha: selected.sha256(shellBytes), lineage, completedAt });
ok(result.ok && result.selected.length === 15, 'fixture produces a complete control-valid C1 slate');
ok(selected.validateSelectedSlate(ROOT, document).valid, 'C1 selected document passes schema and semantic verification');
ok(document.observed_pool.length === 15 && /^[0-9a-f]{64}$/.test(document.observed_pool_sha256), 'success preserves and hashes the full observed pool');
const wrongRun = JSON.parse(JSON.stringify(document)); wrongRun.run = 'C2';
ok(!selected.validateSelectedSlate(ROOT, wrongRun).valid, 'run relabeling is rejected by path and checkpoint bindings');
const tamperedPool = JSON.parse(JSON.stringify(document)); tamperedPool.observed_pool[0].canonical_id = 'tampered';
ok(!selected.validateSelectedSlate(ROOT, tamperedPool).valid, 'successful observed-pool tampering breaks validation');
const tamperedSlot = JSON.parse(JSON.stringify(document)); tamperedSlot.slots[0].subject.canonical_id = 'outside-pool';
ok(!selected.validateSelectedSlate(ROOT, tamperedSlot).valid, 'selected identity outside eligible observed pool is rejected');
const duplicatePair = JSON.parse(JSON.stringify(document)); duplicatePair.slots[0].possible_duplicate_refs = [`${document.slots[1].source_id}|${document.slots[1].subject.canonical_id}`];
ok(!selected.validateSelectedSlate(ROOT, duplicatePair).valid, 'even an asymmetric duplicate reference cannot select both identities');

function memoryTarget(over = {}) {
  let resultBytes = null, markerBytes = null;
  return {
    resultExists: () => !!resultBytes,
    markerExists: () => !!markerBytes,
    writeResult: (bytes) => { if (over.failResult) throw new Error('result fail'); resultBytes = Buffer.from(bytes); },
    readResult: () => over.driftResult ? Buffer.from('{}\n') : Buffer.from(resultBytes),
    writeMarker: (bytes) => { if (over.failMarker) throw new Error('marker fail'); markerBytes = Buffer.from(bytes); },
    readMarker: () => over.driftMarker ? Buffer.from('{}\n') : Buffer.from(markerBytes),
    get resultBytes() { return resultBytes; },
    get marker() { return markerBytes ? JSON.parse(markerBytes) : null; },
  };
}
const executionHead = '1'.repeat(40), readinessOutputSha256 = '2'.repeat(64);
const args = { run: 'C1', document, authorizationBytes, reconciliationBytes, completedAt, executionHead, readinessOutputSha256, validateDocument: (d) => selected.validateSelectedSlate(ROOT, d) };
let target = memoryTarget();
let tx = selected.runWriteOnceTransaction({ ...args, target });
ok(tx.ok && tx.state === 'SELECTED_RECORDED_AUTHORIZATION_SPENT', 'selected bytes are verified before the shared single-use marker');
ok(target.marker.execution_head === executionHead && target.marker.readiness_output_sha256 === readinessOutputSha256, 'selected completion binds execution HEAD and readiness output hash');
ok(selected.runWriteOnceTransaction({ ...args, target }).state === 'REFUSED_ALREADY_STARTED', 'selected authorization cannot write twice');
ok(selected.runWriteOnceTransaction({ ...args, target: memoryTarget({ driftResult: true }) }).state === 'RECONCILIATION_REQUIRED', 'selected read-back mismatch requires reconciliation');
ok(selected.runWriteOnceTransaction({ ...args, target: memoryTarget({ failMarker: true }) }).state === 'RECONCILIATION_REQUIRED', 'selected marker failure consumes retry safety');
ok(selected.runWriteOnceTransaction({ ...args, target: memoryTarget({ driftMarker: true }) }).state === 'RECONCILIATION_REQUIRED', 'selected marker read-back drift requires reconciliation');

console.log('== shared completion cannot cross-bind outcomes ==');
const marker = completion.buildCompletionMarker({ run: 'C1', outcome: 'SELECTED', completedAt, resultBytes: target.resultBytes, authorizationBytes, reconciliationBytes, executionHead, readinessOutputSha256 });
ok(completion.validateCompletionMarker(marker, { run: 'C1', outcome: 'SELECTED', completedAt, resultBytes: target.resultBytes, authorizationBytes, reconciliationBytes, executionHead, readinessOutputSha256 }).valid, 'shared completion validates its selected outcome');
ok(!completion.validateCompletionMarker(marker, { run: 'C1', outcome: 'SHORTAGE_EVENT', completedAt, resultBytes: target.resultBytes, authorizationBytes, reconciliationBytes, executionHead, readinessOutputSha256 }).valid, 'selected marker cannot be relabeled as shortage');
ok(!completion.validateCompletionMarker(marker, { run: 'C2', outcome: 'SELECTED', completedAt, resultBytes: target.resultBytes, authorizationBytes, reconciliationBytes, executionHead, readinessOutputSha256 }).valid, 'C1 marker cannot be reused for C2');

console.log('== pure rerun gate and pin contract ==');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-e2-rerun-'));
const write = (rel, value) => { const full = path.join(tmp, rel); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n'); };
for (const rel of new Set([...Object.values(gate.lineagePaths), ...Object.values(gate.REQUIRED_INFRASTRUCTURE), gate.C0_AUTH_PATH])) write(rel, fs.readFileSync(path.join(ROOT, rel)));
const c0AuthBytes = fs.readFileSync(path.join(tmp, gate.C0_AUTH_PATH));
const reconciliation = {
  artifact_class: 'GOVERNANCE_EXECUTION_RECONCILIATION', not_a_capital_instrument: true,
  record_id: 'epoch2-c0-shortage-reconciliation-001', epoch: 2, run: 'C0', authorization_id: 'intake-execution-002',
  authorization_record: { path: gate.C0_AUTH_PATH, sha256: gate.sha256(c0AuthBytes) },
  execution_head: '4'.repeat(40), cutoff: gate.C0_CUTOFF,
  observed_outcome: { state: 'SHORTAGE_EVENT', selected_slate_written: false, completion_marker_written: false, capital_activity_occurred: false },
  evidence_limitation: { classification: 'RUNNER_OUTPUT_PERSISTENCE_DEFECT', statement: 'The record does not reconstruct or fabricate missing identities.' },
  authorization_disposition: { single_use_consumed_conservatively: true, reuse_prohibited: true, c1_authorized_here: false },
  owner_authorization: { state: 'OWNER_AUTHORIZED_RECONCILIATION', authorized_at: '2026-09-09T12:00:00Z' },
  recorded_at: '2026-09-09T12:01:00Z', owner_ratification_required: false,
  frozen_rerun_schedule: [
    { run: 'C1', days_after_c0: 7, timestamp: completion.CHECKPOINTS.C1.timestamp },
    { run: 'C2', days_after_c0: 14, timestamp: completion.CHECKPOINTS.C2.timestamp },
    { run: 'C3', days_after_c0: 21, timestamp: completion.CHECKPOINTS.C3.timestamp },
  ],
};
write(completion.RECONCILIATION_PATH, reconciliation);
const pin = (rel) => ({ path: rel, sha256: gate.sha256(fs.readFileSync(path.join(tmp, rel))) });
const files = Object.fromEntries(Object.entries(gate.REQUIRED_INFRASTRUCTURE).map(([key, rel]) => [key, pin(rel)]));
const auth = {
  artifact_class: 'GOVERNANCE_EXECUTION_AUTHORIZATION', not_a_capital_instrument: true,
  gate: 'CANDIDATE_INTAKE_RERUN_EXECUTION', authorization_id: 'intake-execution-003', authorized: true, epoch: 2, run: 'C1', scheduled_not_before: C1,
  predecessor: { authorization: gate.C0_AUTH_PATH, required_disposition: 'CONSUMED_BY_C0_SHORTAGE_ATTEMPT', reconciliation_record: completion.RECONCILIATION_PATH },
  scope: { what_is_authorized: 'EXACTLY ONE supervised Epoch 2 C1 candidate-intake rerun', single_use: true, completion_marker_path: completion.markerPath('C1'), may_reuse_intake_execution_002: false, may_change_sources_or_thresholds: false, may_create_capital_activity: false },
  pins: {
    ...Object.fromEntries(Object.entries(gate.lineagePaths).map(([key, rel]) => [key, pin(rel)])),
    c0_reconciliation: pin(completion.RECONCILIATION_PATH), frozen_c0_cutoff: gate.C0_CUTOFF, checkpoint_timestamp: C1,
    execution_infrastructure: { public_commit: '3'.repeat(40), files },
  },
  owner_authorization: { state: 'OWNER_AUTHORIZED_EXECUTION', authorized_at: '2026-09-09T12:05:00Z', scope: 'EXACTLY ONE supervised Epoch 2 C1 candidate-intake rerun' },
  recorded_at: '2026-09-09T12:06:00Z', owner_ratification_required: false,
};
write(completion.authPath('C1'), auth);
let evaluation = gate.evaluateRerunFromRepo(tmp, 'C1', { nowMs: Date.parse('2026-09-10T00:10:00Z'), supervisedMode: true, readinessAggregate: 'READY' });
ok(evaluation.allowed, 'exact reconciliation, authorization, pins, schedule, supervision, and READY can satisfy the pure gate');
auth.scheduled_not_before = '2026-09-11T00:00:00.000Z'; write(completion.authPath('C1'), auth);
evaluation = gate.evaluateRerunFromRepo(tmp, 'C1', { nowMs: Date.parse('2026-09-10T00:10:00Z'), supervisedMode: true, readinessAggregate: 'READY' });
ok(!evaluation.allowed && evaluation.failures.some((x) => /^AUTH: authorization identity\/schedule/.test(x)), 'authorization cannot move the frozen checkpoint');
auth.scheduled_not_before = C1; write(completion.authPath('C1'), auth);
evaluation = gate.evaluateRerunFromRepo(tmp, 'C1', { nowMs: Date.parse('2026-09-09T23:59:59Z'), supervisedMode: true, readinessAggregate: 'READY' });
ok(!evaluation.allowed && evaluation.failures.some((x) => /^TIME: /.test(x)), 'C1 refuses one second before its frozen checkpoint');
ok(!gate.evaluateRerunFromRepo(tmp, 'C2', { nowMs: Date.parse('2026-09-17T00:10:00Z'), supervisedMode: true, readinessAggregate: 'READY' }).allowed, 'C2 refuses without a valid C1 shortage completion');
fs.rmSync(tmp, { recursive: true, force: true });

console.log('== rerun readiness provenance ==');
const fixtureHead = '5'.repeat(40);
let verifierRuns = 0;
function readinessSys({ dirty = false, driftHead = false } = {}) {
  let heads = 0, times = 0;
  return {
    git: (_root, args) => {
      if (args[0] === 'status') return { status: 0, stdout: dirty ? ' M tools/run-epoch2-rerun-intake.js\n' : '', stderr: '' };
      if (args[0] === 'rev-parse') return { status: 0, stdout: ((driftHead && heads++ > 0) ? '6'.repeat(40) : fixtureHead) + '\n', stderr: '' };
      if (args[0] === 'show') { const rel = args[1].split(':').slice(1).join(':'); return { status: 0, stdout: `bytes:${rel}`, stderr: '' }; }
      if (args[0] === 'merge-base') return { status: 0, stdout: '', stderr: '' };
      return { status: 1, stdout: '', stderr: 'unexpected git call' };
    },
    runVerifier: () => { verifierRuns++; return { status: 0, stdout: 'AGGREGATE INTAKE_READINESS: READY\n' }; },
    readFile: (_root, rel) => Buffer.from(`bytes:${rel}`),
    now: () => new Date(Date.parse('2026-09-10T00:05:00Z') + times++ * 1000),
  };
}
verifierRuns = 0;
const cleanProbe = readiness.__testOnly.runReadinessTransactionWith(readinessSys(), '/fixture');
ok(cleanProbe.aggregate === 'READY' && cleanProbe.critical_files_verified && verifierRuns === 1, 'clean rerun readiness verifies every critical HEAD blob before the live-only probe');
ok(readiness.validateReadinessProvenance(cleanProbe, { nowMs: Date.parse('2026-09-10T00:05:02Z'), headSha: fixtureHead }).valid, 'fresh clean rerun readiness is bound to the post-probe HEAD');
verifierRuns = 0;
const dirtyProbe = readiness.__testOnly.runReadinessTransactionWith(readinessSys({ dirty: true }), '/fixture');
ok(dirtyProbe.aggregate === null && verifierRuns === 0 && !readiness.validateReadinessProvenance(dirtyProbe, { nowMs: Date.parse('2026-09-10T00:05:02Z'), headSha: fixtureHead }).valid, 'dirty tree refuses before the live readiness verifier runs');
const headDrift = readiness.__testOnly.runReadinessTransactionWith(readinessSys({ driftHead: true }), '/fixture');
ok(!readiness.validateReadinessProvenance(headDrift, { nowMs: Date.parse('2026-09-10T00:05:02Z'), headSha: '6'.repeat(40) }).valid, 'HEAD change during the readiness transaction is rejected');
const onePath = readiness.EXECUTION_CRITICAL_FILES[0];
const onePin = { [onePath]: crypto.createHash('sha256').update(`bytes:${onePath}`).digest('hex') };
ok(readiness.__testOnly.verifyPinnedCommitWith(readinessSys(), '/fixture', '7'.repeat(40), onePin).valid, 'authorization pins are verified against their exact public-commit blobs');
onePin[onePath] = '8'.repeat(64);
ok(!readiness.__testOnly.verifyPinnedCommitWith(readinessSys(), '/fixture', '7'.repeat(40), onePin).valid, 'public-commit blob drift is rejected');

console.log('== production and CI refusal surfaces ==');
ok(c0gate.C0_EXECUTION_PERMANENTLY_CONSUMED === true && c0gate.evaluateEpoch2ForProcess(ROOT).executable === false, 'historical authorization 002 is permanently non-executable in production');
const processRefusal = gate.evaluateRerunForProcess(ROOT, 'C1');
ok(processRefusal.executable === false && !processRefusal.readinessProvenance, 'missing final C0 reconciliation/C1 authorization refuses before any live readiness probe');
ok(ciGuard.decide(ROOT, Date.parse('2026-09-10T00:10:00Z')).pass, 'CI guard treats only absent future authority as lawful and never executes intake');
ok(runner.parseRunArg(['--run=C1']) === 'C1' && runner.parseRunArg(['--run=C1', '--run=C2']) === null && runner.parseRunArg(['--run=C0']) === null, 'runner accepts exactly one declared C1-C3 run');
ok(/buildLiveProvider\(\{ repoRoot: ROOT, nowMs: Date\.parse\(authorization\.checkpointTimestamp\) \}\)/.test(fs.readFileSync(path.join(ROOT, 'tools/run-epoch2-rerun-intake.js'), 'utf8')), 'rerun acquisition window is anchored to the frozen checkpoint, not invocation time');
ok(readiness.EXECUTION_CRITICAL_FILES.length === Object.keys(gate.REQUIRED_INFRASTRUCTURE).length && Object.values(gate.REQUIRED_INFRASTRUCTURE).every((x) => readiness.EXECUTION_CRITICAL_FILES.includes(x)), 'readiness and authorization pin the same complete execution-critical set');
ok(canonicalize(shortage.CHECKPOINTS) === canonicalize({ C1: { authorization: 'intake-execution-003', days_after_c0: 7, timestamp: C1 }, C2: { authorization: 'intake-execution-004', days_after_c0: 14, timestamp: completion.CHECKPOINTS.C2.timestamp }, C3: { authorization: 'intake-execution-005', days_after_c0: 21, timestamp: completion.CHECKPOINTS.C3.timestamp } }), 'rerun checkpoints remain exactly C1/C2/C3 from the frozen C0 schedule');

console.log(`\nEPOCH 2 RERUN INTEGRATION: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
