#!/usr/bin/env node
// EPOCH 2 / v0.3 cutoff resolver tests — EPOCH2_CUTOFF_RULE_CANONICAL_V03.
// TEST EXPECTATIONS ONLY: nothing here records a cutoff into governance.
'use strict';
const path = require('path');
const fs = require('fs');
const { computeEpoch2Cutoff, computeEpoch2CutoffFromRepo, readRatificationRecordV2, computeCutoffFromRepo, RATIFIED_AT_V2_RE } = require('./lib/intake-cutoff.js');
const { evaluateExecutionPreconditions } = require('./lib/intake-authorization.js');
const ROOT = path.join(__dirname, '..');
let n = 0, fails = 0;
const ok = (c, msg) => { n++; console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const AD3 = { status: 'VERIFIED', verified_at: '2026-08-29T23:27:52Z' };
const RAT = { exists: true, ratified: true, ratified_at: '2026-09-01T23:23:02Z' };

// 1. exact mechanical expectation from the public inputs
const r1 = computeEpoch2Cutoff({ ad3Status: AD3, ratificationV2: RAT }, Date.parse('2026-09-02T00:00:00Z'));
ok(r1.defined === true && r1.cutoffTimestamp === '2026-09-03T00:00:00.000Z', 'public inputs -> cutoff 2026-09-03T00:00:00.000Z (test expectation only)');
ok(r1.laterConditionWas === 'v0.3 ratification (ratified_at)', 'later-of picks the v0.3 ratified_at');
ok(r1.reached === false, 'not reached at 2026-09-02T00:00Z');
ok(computeEpoch2Cutoff({ ad3Status: AD3, ratificationV2: RAT }, Date.parse('2026-09-03T00:00:00Z')).reached === true, 'reached exactly at the midnight boundary');
// 2. authorization separation — ALWAYS false, reached or not
ok(r1.epoch2IntakeAuthorized === false, 'not reached: epoch2IntakeAuthorized false');
ok(computeEpoch2Cutoff({ ad3Status: AD3, ratificationV2: RAT }, Date.parse('2027-01-01T00:00:00Z')).epoch2IntakeAuthorized === false, 'cutoff reached does NOT authorize Epoch 2 intake');
ok(!('authorized' in r1), 'v2 result exposes no v1-style authorized field at all');
// 3. later-of arithmetic + UTC midnight normalization (synthetic)
const r3 = computeEpoch2Cutoff({ ad3Status: { status: 'VERIFIED', verified_at: '2026-09-05T01:02:03Z' }, ratificationV2: RAT }, 0);
ok(r3.cutoffTimestamp === '2026-09-07T00:00:00.000Z' && r3.laterConditionWas === 'AD-3 VERIFIED', 'later-of switches to AD-3 when later; +2d midnight UTC');
ok(computeEpoch2Cutoff({ ad3Status: AD3, ratificationV2: { exists: true, ratified: true, ratified_at: '2026-08-31T23:59:59Z' } }, 0).cutoffTimestamp === '2026-09-02T00:00:00.000Z', 'end-of-day input still normalizes to midnight +2 calendar days');
// 4. undefined states
ok(computeEpoch2Cutoff({ ad3Status: AD3, ratificationV2: { exists: false, ratified: false, ratified_at: null } }, 0).defined === false, 'missing v2 -> cutoff undefined');
ok(computeEpoch2Cutoff({ ad3Status: AD3, ratificationV2: { exists: true, ratified: false, ratified_at: '2026-09-01T23:23:02Z' } }, 0).defined === false, 'ratified:false -> undefined');
for (const bad of ['2026-09-01', '2026-09-01T23:23:02', '2026-09-01T23:23:02+00:00', '2026-09-01T23:23Z', 'garbage', '', null]) {
  ok(computeEpoch2Cutoff({ ad3Status: AD3, ratificationV2: { exists: true, ratified: true, ratified_at: bad } }, 0).defined === false, `malformed/absent ratified_at (${JSON.stringify(bad)}) -> undefined (full UTC with seconds required; date-only rejected)`);
}
ok(computeEpoch2Cutoff({ ad3Status: { status: 'MISSING', verified_at: null }, ratificationV2: RAT }, 0).defined === false, 'AD-3 missing/unverified -> undefined');
// 5. v1 cannot substitute for v2 — resolver reads ONLY the .v2 filename
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'e2-')); fs.mkdirSync(path.join(tmp, 'governance/experiments/stage0-public-experiment-v1'), { recursive: true }); fs.mkdirSync(path.join(tmp, 'governance/gates'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'governance/gates/build03-1-ad3-status.v2.json'), path.join(tmp, 'governance/gates/build03-1-ad3-status.v2.json'));
fs.copyFileSync(path.join(ROOT, 'governance/experiments/stage0-public-experiment-v1/candidate-selection-ratification.json'), path.join(tmp, 'governance/experiments/stage0-public-experiment-v1/candidate-selection-ratification.json'));
const r5 = computeEpoch2CutoffFromRepo(tmp, 0);
ok(r5.defined === false && /v1 ratification is NOT a substitute/.test(r5.reason), 'repo with ONLY v1 ratification -> Epoch 2 cutoff undefined (v1 never substitutes)');
// 6. stale nested input_2 fields are structurally ignored (poisoned fixture)
const poisoned = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/experiments/stage0-public-experiment-v1/candidate-selection-ratification.v2.json'), 'utf8'));
poisoned.cutoff_rule.input_2.value = '2031-12-31T23:59:59Z — POISON, must never be read';
poisoned.cutoff_rule.input_2.state = 'POISON';
fs.writeFileSync(path.join(tmp, 'governance/experiments/stage0-public-experiment-v1/candidate-selection-ratification.v2.json'), JSON.stringify(poisoned));
const r6 = computeEpoch2CutoffFromRepo(tmp, Date.parse('2026-09-02T00:00:00Z'));
ok(r6.defined === true && r6.cutoffTimestamp === '2026-09-03T00:00:00.000Z', 'poisoned nested input_2.value/state ignored — top-level ratified_at is the sole temporal input (clarification semantics respected)');
const src = fs.readFileSync(path.join(__dirname, 'lib/intake-cutoff.js'), 'utf8');
ok(!/input_2\.(value|state)/.test(src.replace(/\/\/[^\n]*/g, '')), 'resolver source never reads input_2.value/state outside comments');
// 7. no override path / no third trigger
ok(!/process\.env/.test(src), 'no environment override in the cutoff library');
ok((src.match(/CUTOFF_BUFFER_DAYS = 2/g) || []).length === 1 && !/CUTOFF_BUFFER_DAYS\s*=[^=]/.test(src.split('CUTOFF_BUFFER_DAYS = 2')[1] || ''), 'two-day buffer frozen, single assignment');
ok(computeEpoch2Cutoff.length === 2 && /\{ ad3Status, ratificationV2 \}/.test(src), 'exactly two condition inputs — no third trigger parameter');
// 8. real repo state (read-only): defined from public records; authorization still false
const rr = computeEpoch2CutoffFromRepo(ROOT, Date.parse('2026-09-01T23:30:00Z'));
ok(rr.defined === true && rr.epoch2IntakeAuthorized === false, 'real repo: Epoch 2 cutoff defined from public v0.3 records; intake NOT authorized');
ok(readRatificationRecordV2(ROOT).ratified_at === '2026-09-01T23:23:02Z' && RATIFIED_AT_V2_RE.test('2026-09-01T23:23:02Z'), 'real repo top-level ratified_at read verbatim');
// 9. v1 path unchanged (historical reconstruction)
const v1 = computeCutoffFromRepo(ROOT, Date.parse('2026-09-01T00:00:00Z'));
ok(v1.defined === true && v1.cutoffTimestamp === '2026-08-31T00:00:00.000Z', 'v0.2 lineage still reconstructs Epoch 1 cutoff 2026-08-31T00:00:00.000Z');
// 10. supersession enforcement: a v0.2-pinned authorization is refused even with every other gate green
const V02='751953212fa1f17d0041fc6f3d36c570dae66d25c62d4ac16ed4f9849aaf5927';
const auth={name:'intake-execution-001.json',record:{artifact_class:'GOVERNANCE_EXECUTION_AUTHORIZATION',gate:'CANDIDATE_INTAKE_EXECUTION',authorized:true,scope:{single_use:true,completion_marker_path:'governance/gates/x.json'},pins:{methodology:{sha256:V02},experiment_freeze:{sha256:'a'.repeat(64)},pre_intake_candidate_slate_sha256:'b'.repeat(64),frozen_cutoff:'2026-08-31T00:00:00.000Z'}}};
const base={cutoff:{defined:true,reached:true,cutoffTimestamp:'2026-08-31T00:00:00.000Z'},authRecords:[auth],methodologySha:V02,freezeSha:'a'.repeat(64),slateShaNow:'b'.repeat(64),completionMarkerExists:false,blockedRecordsPresent:false,tallyKeyPresent:true,readinessAggregate:'READY',supervisedMode:true};
const noSup=evaluateExecutionPreconditions({...base,supersededMethodologyShas:[]});
const withSup=evaluateExecutionPreconditions({...base,supersededMethodologyShas:[V02]});
ok(!(noSup.failures||[]).some(f=>/^S:/.test(f)), 'without supersession list the legacy evaluation is unchanged');
ok((withSup.failures||[]).some(f=>/UNUSABLE FOR SUPERSEDED METHODOLOGY/.test(f)), 'with recorded supersession, v0.2-pinned authorization is mechanically refused');
fs.rmSync(tmp,{recursive:true,force:true});
console.log(`\n${n} checks, ${fails} failure(s).`); process.exit(fails?1:0);
