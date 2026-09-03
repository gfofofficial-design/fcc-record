#!/usr/bin/env node
// Epoch 2 Phase-1 execution infrastructure — deterministic, no network, temp-only writes.
'use strict';
const fs = require('fs');
const path = require('path');
const sel = require('./lib/epoch2-selection.js');
const writer = require('./lib/epoch2-selected-slate-writer.js');
const completion = require('./lib/epoch2-completion.js');

const ROOT = path.join(__dirname, '..');
const CUT = '2026-09-03T00:00:00.000Z';
let pass = 0, fail = 0;
const ok = (c, n) => { console.log((c ? 'PASS ' : 'FAIL ') + n); c ? pass++ : fail++; };
const iso = (days) => new Date(Date.parse(CUT) + days * 86400000).toISOString();
function item(sourceId, id, days, { material = false, opened = '2026-09-01T00:00:00.000Z', observableType } = {}) {
  const defaultObs = sourceId === 'A2' ? 'OBS_SOURCE_NATIVE_DATE' : sourceId === 'B2' ? 'OBS_SOURCE_NATIVE_DATE' : sourceId === 'E1' ? 'OBS_SOURCE_NATIVE_DATE' : 'OBS_SOURCE_NATIVE_DATE';
  return { sourceId, canonicalId: id, openedAt: opened, resolutionDate: iso(days), observableType: observableType || defaultObs, assetId: `asset-${id}`, title: `Public candidate ${id}`, qualificationStanceShaped: true, subjectTouchesFederation: false, materialRisk: material, possibleDuplicateRefs: [] };
}
const pool = [];
for (let i = 0; i < 5; i++) pool.push(item('A1', `a-${i}`, 5 + i));
for (let i = 0; i < 5; i++) pool.push(item('B2', `b-${i}`, 20 + i));
for (let i = 0; i < 5; i++) pool.push(item('E1', `e-${i}`, 50 + i));
pool.push(item('A1', 'a-material', 10, { material: true, opened: '2026-09-02T00:00:00.000Z' }));
pool.push(item('B2', 'b-material', 30, { material: true, opened: '2026-09-02T00:00:00.000Z' }));
pool.push(item('E1', 'e-material', 70, { material: true, opened: '2026-09-02T00:00:00.000Z' }));

console.log('== deterministic selection and frozen controls ==');
const r1 = sel.selectEpoch2(pool, { cutoff: CUT });
const r2 = sel.selectEpoch2(pool.slice().reverse(), { cutoff: CUT });
ok(r1.ok && r1.selected.length === 15, 'selects exactly 15 only when all controls and difficulty quota pass');
ok(JSON.stringify(r1.selected.map(sel.stableId)) === JSON.stringify(r2.selected.map(sel.stableId)), 'input order cannot change the selected slate');
ok(r1.control.valid && Object.values(r1.control.counts.bands).every((n) => n === 5), 'H1/H2/H3 mechanically verified');
ok(r1.control.counts.distinctClasses === 3 && Object.values(r1.control.counts.classes).every((n) => n <= 7) && r1.control.counts.governanceVotes <= 7, 'S1/S2/S3 mechanically verified');
ok(r1.difficulty.quotaMet && r1.difficulty.materialCount === 3 && r1.difficulty.substitutions.length === 3, 'difficulty quota met only by deterministic substitutions');

console.log('== fail-closed eligibility and shortages ==');
const rejected = sel.selectEpoch2(pool.concat([
  item('A1', 'epoch1', 5, { opened: '2026-08-31T00:00:00.000Z' }),
  item('A1', 'future', 5, { opened: '2026-09-04T00:00:00.000Z' }),
  item('B1', 'rd-without-addendum', 45, { observableType: 'OBS_RULE_DERIVED_DATE' }),
  item('D1', 'unlisted-observable', 45),
]), { cutoff: CUT });
const reasons = rejected.rejected.map((x) => x.reason).join('|');
ok(/anti-carry-over/.test(reasons), 'opening at or before Epoch 1 cutoff is excluded');
ok(/after the fixed acquisition cutoff/.test(reasons), 'future opening timestamp is excluded');
ok(/addendum-002.*ZERO/.test(reasons), 'B1/F1 rule-derived contribution remains zero because addendum-002 missed cutoff');
ok(/not whitelisted/.test(reasons), 'source/observable mismatch is excluded');
const shortage = sel.selectEpoch2(pool.filter((x) => x.sourceId === 'A1'), { cutoff: CUT });
ok(!shortage.ok && shortage.state === 'SHORTAGE_EVENT' && shortage.rerun_schedule.map((x) => x.days_after_c0).join(',') === '7,14,21', 'unsatisfied controls produce the exact C1/C2/C3 rerun schedule');
const noDifficulty = sel.selectEpoch2(pool.filter((x) => !x.materialRisk), { cutoff: CUT });
ok(!noDifficulty.ok && noDifficulty.state === 'DIFFICULTY_QUOTA_UNSATISFIED', 'a composition-valid slate without three material counter-theses cannot publish');
const dupePool = pool.concat({ ...pool[0] });
ok(sel.selectEpoch2(dupePool, { cutoff: CUT }).duplicates.length === 1, 'exact stable-identity duplicates are logged and not selected twice');
const pd = sel.flagPossibleDuplicates([
  { ...item('A1', 'pd-a', 10), assetId: 'same', keywords: ['same', 'question'] },
  { ...item('A2', 'pd-b', 12), assetId: 'same', keywords: ['same', 'question'] },
]);
ok(pd.flags.length === 1 && pd.pool.every((x) => x.possibleDuplicateRefs.length === 1), 'cross-source semantic similarity only flags both candidates; it never merges them');
let ambiguous = false;
try { sel.selectEpoch2(pool.concat(item('A2', 'a-0', 7)), { cutoff: CUT }); } catch (e) { ambiguous = /ambiguous deterministic order/.test(e.message); }
ok(ambiguous, 'unresolved equal order keys fail closed instead of inventing a third tie-break');

console.log('== selected artifact schema and semantic binding ==');
const hx = (c) => c.repeat(64);
const lineage = { methodology: hx('a'), experiment_spec: hx('b'), experiment_freeze: hx('c'), supersession_record: hx('d') };
const doc = writer.buildSelectedSlate({ result: r1, authorizationSha: hx('e'), shellSha: hx('f'), lineage, completedAt: '2026-09-03T01:00:00Z' });
const vd = writer.validateSelectedSlate(ROOT, doc);
ok(vd.valid && doc.observed_pool.length === pool.length && doc.slots.length === 15, 'selected artifact validates and preserves every observed stable id/opening timestamp');
const badClass = JSON.parse(JSON.stringify(doc)); badClass.slots[0].source_class = 'F';
ok(!writer.validateSelectedSlate(ROOT, badClass).valid, 'schema/semantic verifier rejects source-class drift');
const badHorizon = JSON.parse(JSON.stringify(doc)); badHorizon.slots[0].subject.days_to_resolution = 6.5;
ok(!writer.validateSelectedSlate(ROOT, badHorizon).valid, 'semantic verifier recomputes horizon arithmetic');
const badSlot = JSON.parse(JSON.stringify(doc)); badSlot.slots[1].slot_id = badSlot.slots[0].slot_id;
ok(!writer.validateSelectedSlate(ROOT, badSlot).valid, 'duplicate slot ids are rejected');
const badDifficulty = JSON.parse(JSON.stringify(doc)); badDifficulty.slots.filter((x) => x.standing_adversary_counter_thesis_risk).forEach((x) => { x.standing_adversary_counter_thesis_risk = false; }); badDifficulty.difficulty_control.actual_material_count = 0;
ok(!writer.validateSelectedSlate(ROOT, badDifficulty).valid, 'published artifact must prove at least three material counter-theses');
const badRef = JSON.parse(JSON.stringify(doc)); badRef.slots[0].possible_duplicate_refs = ['A1|fabricated'];
ok(!writer.validateSelectedSlate(ROOT, badRef).valid, 'duplicate references must bind to identities in the observed pool');

console.log('== write-once transaction and completion binding ==');
function memoryTarget(over = {}) {
  let selected = null, marker = null;
  return {
    selectedExists: () => !!selected, markerExists: () => !!marker,
    writeSelected: (b) => { if (over.failSelected) throw new Error('selected fail'); selected = Buffer.from(b); },
    readSelected: () => over.driftRead ? Buffer.from('{}\n') : Buffer.from(selected),
    writeMarker: (m) => { if (over.failMarker) throw new Error('marker fail'); marker = JSON.parse(JSON.stringify(m)); },
    get selected() { return selected; }, get marker() { return marker; },
  };
}
const authBytes = Buffer.from('{"authorization":"002"}\n'), shellBytes = Buffer.from('{"shell":"v2"}\n');
const txnArgs = { document: doc, authorizationBytes: authBytes, shellBytes, cutoff: CUT, lineage, completedAt: '2026-09-03T01:00:00Z', validateDocument: (d) => writer.validateSelectedSlate(ROOT, d) };
const target = memoryTarget(); const tx = writer.runWriteOnceTransaction({ ...txnArgs, target });
ok(tx.ok && target.marker && target.selected, 'selected bytes are verified before the completion marker is written');
ok(writer.runWriteOnceTransaction({ ...txnArgs, target }).state === 'REFUSED_ALREADY_STARTED', 'a second execution is refused permanently');
ok(writer.runWriteOnceTransaction({ ...txnArgs, target: memoryTarget({ failSelected: true }) }).state === 'SELECTED_WRITE_FAILED_NO_MARKER', 'selected write failure creates no marker');
ok(writer.runWriteOnceTransaction({ ...txnArgs, target: memoryTarget({ driftRead: true }) }).state === 'RECONCILIATION_REQUIRED', 'selected read-back drift requires reconciliation and no rerun');
ok(writer.runWriteOnceTransaction({ ...txnArgs, target: memoryTarget({ failMarker: true }) }).state === 'RECONCILIATION_REQUIRED', 'marker failure after selected write requires reconciliation');
const vm = completion.validateCompletionMarker(tx.marker, { selectedBytes: target.selected, authorizationBytes: authBytes, shellBytes, cutoff: CUT, lineage, nowMs: Date.parse('2026-09-03T01:00:00Z') });
ok(vm.valid, 'completion marker binds selected bytes, authorization, shell, cutoff and lineage');
ok(!completion.validateCompletionMarker({ ...tx.marker, cutoff: '2026-09-04T00:00:00.000Z' }, { selectedBytes: target.selected, authorizationBytes: authBytes, shellBytes, cutoff: CUT, lineage }).valid, 'completion verifier rejects cutoff drift');

console.log('== Phase 2 pins recorded; production remains inert without owner authorization ==');
const runner = fs.readFileSync(path.join(ROOT, 'tools/run-epoch2-candidate-intake.js'), 'utf8');
ok(runner.indexOf('evaluateEpoch2ForProcess(ROOT)') < runner.indexOf("require('./lib/live-acquisition-provider.js')"), 'runner evaluates the process-bound gate before loading acquisition code');
ok(!fs.existsSync(path.join(ROOT, completion.SELECTED_PATH)) && !fs.existsSync(path.join(ROOT, completion.MARKER_PATH)) && !fs.existsSync(path.join(ROOT, completion.AUTH_PATH)), 'real repository untouched: no 002, selected slate or completion marker');
const state = require('./lib/epoch2-intake-authorization.js').deriveEpoch2State(ROOT, { nowMs: Date.parse('2026-09-03T02:00:00Z') });
const gateModule = require('./lib/epoch2-intake-authorization.js');
ok(gateModule.executionInfrastructureStatus().complete, 'all seven infrastructure components carry recorded pins');
ok(gateModule.verifyExecutionInfrastructureFiles(ROOT).valid, 'every recorded infrastructure hash matches the repository bytes');
ok(gateModule.EXECUTION_INFRASTRUCTURE.execution_head === 'a0e3eb2507b91fdbb76faa28169a9cacaa30297c', 'execution HEAD is the exact public merge commit of Phase 1 PR #5');
ok(state.state === 'READY_FOR_OWNER_AUTHORIZATION', 'production advances only to READY_FOR_OWNER_AUTHORIZATION; no 002 means no execution');

console.log(`\nEPOCH 2 EXECUTION INFRASTRUCTURE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
