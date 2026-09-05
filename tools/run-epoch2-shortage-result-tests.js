#!/usr/bin/env node
// Infrastructure-only tests for future Epoch 2 C1-C3 shortage persistence.
// No network, no production paths, no process authority.
'use strict';
const shortage = require('./lib/epoch2-shortage-result.js');
const selection = require('./lib/epoch2-selection.js');
const ROOT = require('path').join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (condition, name) => { console.log((condition ? 'PASS ' : 'FAIL ') + name); condition ? pass++ : fail++; };
const hx = (c) => c.repeat(64);
const C1 = shortage.CHECKPOINTS.C1.timestamp;
const item = (id, days, sourceId = 'A1') => ({ sourceId, canonicalId: id, openedAt: '2026-09-08T00:00:00.000Z', resolutionDate: new Date(Date.parse(C1) + days * 86400000).toISOString(), observableType: 'OBS_SOURCE_NATIVE_DATE', assetId: id, title: `Candidate ${id}`, qualificationStanceShaped: true, subjectTouchesFederation: false, materialRisk: false, possibleDuplicateRefs: [] });
const result = selection.selectEpoch2([item('a-1', 5), item('a-2', 6), item('a-1', 5), item('b1-zero', 30, 'B1')], { cutoff: C1 });
const lineage = { methodology: hx('a'), experiment_spec: hx('b'), experiment_freeze: hx('c'), supersession_record: hx('d') };
const doc = shortage.buildShortageEvent({ run: 'C1', result, authorizationSha: hx('e'), reconciliationSha: hx('f'), lineage, completedAt: '2026-09-10T00:05:00Z' });

console.log('== complete deterministic shortage artifact ==');
ok(result.ok === false && result.state === 'SHORTAGE_EVENT', 'fixture produces a shortage, not a selected slate');
ok(doc.observed_pool.length === 4 && doc.observed_pool.filter((x) => x.disposition === 'EXACT_DUPLICATE').length === 1 && doc.observed_pool.filter((x) => x.disposition === 'INELIGIBLE').length === 1, 'full pool includes eligible, rejected, and exact-duplicate identities');
ok(shortage.validateShortageEvent(ROOT, doc).valid, 'shortage artifact passes schema and semantic validation');
ok(doc.deficits.some((x) => x.control === 'N' && x.shortfall === 13), 'N deficit states the exact 13-candidate shortfall');
ok(doc.deficits.some((x) => x.control === 'H2' && /medium/.test(x.detail) && x.shortfall === 2), 'H2 medium deficit is explicit and quantified');
ok(doc.deficits.some((x) => x.control === 'H3' && x.shortfall === 5), 'H3 non-SHORT deficit is explicit and quantified');
ok(doc.deficits.some((x) => x.control === 'S2' && x.shortfall === 2), 'S2 class-diversity deficit is explicit and quantified');
ok(doc.rerun_schedule_remaining.map((x) => x.run).join(',') === 'C2,C3', 'C1 records only the frozen remaining C2/C3 schedule');

console.log('== tamper and schedule rejection ==');
const badHash = JSON.parse(JSON.stringify(doc)); badHash.observed_pool[0].canonical_id = 'tampered';
ok(!shortage.validateShortageEvent(ROOT, badHash).valid, 'observed-pool tampering breaks the embedded pool hash');
const badDeficit = JSON.parse(JSON.stringify(doc)); badDeficit.deficits[0].shortfall--;
ok(!shortage.validateShortageEvent(ROOT, badDeficit).valid, 'deficit tampering is rejected against observed-pool availability');
const badSchedule = JSON.parse(JSON.stringify(doc)); badSchedule.rerun_schedule_remaining[0].timestamp = '2026-09-18T00:00:00.000Z';
ok(!shortage.validateShortageEvent(ROOT, badSchedule).valid, 'owner-selected rerun date is rejected');
let wrongCheckpoint = false;
try { shortage.buildShortageEvent({ run: 'C2', result, authorizationSha: hx('e'), reconciliationSha: hx('f'), lineage, completedAt: '2026-09-17T00:05:00Z' }); } catch (e) { wrongCheckpoint = /frozen C2 checkpoint/.test(e.message); }
ok(wrongCheckpoint, 'a C1 result cannot be relabeled as C2');
const c3Result = selection.selectEpoch2([item('a-1', 19)], { cutoff: shortage.CHECKPOINTS.C3.timestamp });
const c3 = shortage.buildShortageEvent({ run: 'C3', result: c3Result, authorizationSha: hx('e'), reconciliationSha: hx('f'), lineage, completedAt: '2026-09-24T00:05:00Z' });
ok(c3.rerun_schedule_remaining.length === 0, 'C3 shortage cannot invent a fourth rerun');
const difficultyPool = [];
for (let i = 0; i < 5; i++) difficultyPool.push(item(`da-${i}`, 5 + i, 'A1'));
for (let i = 0; i < 5; i++) difficultyPool.push(item(`db-${i}`, 20 + i, 'B2'));
for (let i = 0; i < 5; i++) difficultyPool.push(item(`de-${i}`, 50 + i, 'E1'));
const difficultyResult = selection.selectEpoch2(difficultyPool, { cutoff: C1 });
const difficultyDoc = shortage.buildShortageEvent({ run: 'C1', result: difficultyResult, authorizationSha: hx('e'), reconciliationSha: hx('f'), lineage, completedAt: '2026-09-10T00:05:00Z' });
ok(difficultyResult.state === 'DIFFICULTY_QUOTA_UNSATISFIED' && difficultyDoc.provisional_selected.length === 15 && shortage.validateShortageEvent(ROOT, difficultyDoc).valid, 'difficulty failure preserves its deterministic provisional composition and verifies the exact 3-item shortfall');
const badDifficulty = JSON.parse(JSON.stringify(difficultyDoc)); badDifficulty.provisional_selected[0] = 'A1|invented';
ok(!shortage.validateShortageEvent(ROOT, badDifficulty).valid, 'difficulty proof cannot reference an identity outside the eligible pool');

console.log('== write-once result and completion transaction ==');
function memoryTarget(over = {}) {
  let resultBytes = null, markerBytes = null;
  return {
    resultExists: () => !!resultBytes,
    markerExists: () => !!markerBytes,
    writeResult: (bytes) => { if (over.failResult) throw new Error('result fail'); resultBytes = Buffer.from(bytes); },
    readResult: () => over.driftRead ? Buffer.from('{}\n') : Buffer.from(resultBytes),
    writeMarker: (bytes) => { if (over.failMarker) throw new Error('marker fail'); markerBytes = Buffer.from(bytes); },
    readMarker: () => over.driftMarker ? Buffer.from('{}\n') : Buffer.from(markerBytes),
    get resultBytes() { return resultBytes; },
    get marker() { return markerBytes ? JSON.parse(markerBytes) : null; },
  };
}
const authorizationBytes = Buffer.from('auth-003'), reconciliationBytes = Buffer.from('c0-reconciliation');
const boundDoc = shortage.buildShortageEvent({ run: 'C1', result, authorizationSha: shortage.sha256(authorizationBytes), reconciliationSha: shortage.sha256(reconciliationBytes), lineage, completedAt: '2026-09-10T00:05:00Z' });
const args = { run: 'C1', document: boundDoc, authorizationBytes, reconciliationBytes, completedAt: '2026-09-10T00:05:00Z', validateDocument: (d) => shortage.validateShortageEvent(ROOT, d) };
const target = memoryTarget(); const tx = shortage.runWriteOnceTransaction({ ...args, target });
ok(tx.ok && target.resultBytes && target.marker && target.marker.single_use_consumed === true, 'verified result bytes precede a single-use completion marker');
ok(target.marker.result_artifact.sha256 === shortage.sha256(target.resultBytes), 'completion marker binds the exact shortage artifact bytes');
ok(shortage.runWriteOnceTransaction({ ...args, target }).state === 'REFUSED_ALREADY_STARTED', 'the same authorization cannot write twice');
ok(shortage.runWriteOnceTransaction({ ...args, target: memoryTarget({ failResult: true }) }).state === 'RESULT_WRITE_FAILED_NO_MARKER', 'result write failure creates no completion marker');
ok(shortage.runWriteOnceTransaction({ ...args, target: memoryTarget({ driftRead: true }) }).state === 'RECONCILIATION_REQUIRED', 'read-back mismatch requires reconciliation and forbids retry');
ok(shortage.runWriteOnceTransaction({ ...args, target: memoryTarget({ failMarker: true }) }).state === 'RECONCILIATION_REQUIRED', 'marker failure after result write requires reconciliation and forbids retry');
ok(shortage.runWriteOnceTransaction({ ...args, target: memoryTarget({ driftMarker: true }) }).state === 'RECONCILIATION_REQUIRED', 'marker read-back mismatch requires reconciliation and forbids retry');
const wrongAvailability = JSON.parse(JSON.stringify(doc)); wrongAvailability.availability.eligible_total++;
ok(!shortage.validateShortageEvent(ROOT, wrongAvailability).valid, 'availability tampering is rejected against the hashed observed pool');
ok(shortage.runWriteOnceTransaction({ ...args, run: 'C2', target: memoryTarget() }).state === 'REFUSED_BINDING_MISMATCH', 'transaction run cannot differ from the artifact run');
ok(shortage.runWriteOnceTransaction({ ...args, authorizationBytes: Buffer.from('wrong-auth'), target: memoryTarget() }).state === 'REFUSED_BINDING_MISMATCH', 'transaction authorization bytes must match the artifact pin');

console.log(`\nEPOCH 2 SHORTAGE RESULT INFRASTRUCTURE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
