#!/usr/bin/env node
// FCC STAGE 0 — INTAKE EXECUTION AUTHORIZATION GATE TESTS (additive).
// Proves every refusal branch A–H NOW, before the cutoff, via the pure core;
// proves the real repo's artifact validates and binds; proves ordinary/CI
// invocation can never execute intake.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  evaluateExecutionPreconditions, evaluateFromRepo, validateAuthorizationShape,
  supervisedModeRequested, SUPERVISED_FLAG, SUPERVISED_ENV, SUPERVISED_ENV_VALUE,
} = require('./lib/intake-authorization.js');

const ROOT = path.join(__dirname, '..');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log('PASS ' + l); } else { failed++; console.error('FAIL ' + l); } };

const AUTH = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance', 'gates', 'intake-execution-001.json'), 'utf8'));
const METH = sha('governance/experiments/stage0-public-experiment-v1/FCC_STAGE0_CANDIDATE_SELECTION_METHOD_V0_2.md');
const FRZ = sha('governance/experiments/stage0-public-experiment-v1/experiment-freeze.json');
const SLATE = sha('governance/experiments/stage0-public-experiment-v1/candidate-slate.json');
const CUT_OK = { defined: true, reached: true, authorized: true, cutoffTimestamp: '2026-08-31T00:00:00.000Z' };
const CUT_NOT = { defined: true, reached: false, authorized: false, cutoffTimestamp: '2026-08-31T00:00:00.000Z' };
const GOOD = {
  cutoff: CUT_OK, authRecords: [{ name: 'intake-execution-001.json', record: AUTH }],
  methodologySha: METH, freezeSha: FRZ, slateShaNow: SLATE,
  completionMarkerExists: false, blockedRecordsPresent: false,
  tallyKeyPresent: true, readinessAggregate: 'READY', supervisedMode: true,
};
const withFail = (over, needle, label) => {
  const r = evaluateExecutionPreconditions({ ...GOOD, ...over });
  ok(r.allowed === false && r.failures.some((f) => f.startsWith(needle)), label);
};

// ── artifact validity ────────────────────────────────────────────────────
ok(validateAuthorizationShape(AUTH).length === 0, 'V1: the shipped authorization artifact is shape-valid');
ok(AUTH.pins.methodology.sha256 === METH && AUTH.pins.experiment_freeze.sha256 === FRZ && AUTH.pins.pre_intake_candidate_slate_sha256 === SLATE, 'V2: every pin matches the repository byte-for-byte');
ok(AUTH.pins.frozen_cutoff === '2026-08-31T00:00:00.000Z' && AUTH.scope.single_use === true, 'V3: frozen cutoff pinned exactly; single-use declared');

// ── brief cases A–H via the pure core ────────────────────────────────────
withFail({ cutoff: CUT_NOT }, 'A:', 'A: before cutoff => REFUSE');
withFail({ authRecords: [] }, 'B:', 'B: after cutoff, authorization absent => REFUSE');
withFail({ tallyKeyPresent: false }, 'G:', 'C(brief): authorization present but Tally key absent => REFUSE (presence-only check, value never handled)');
withFail({ readinessAggregate: 'BLOCKED' }, 'H:', 'D(brief): readiness blocked in the execution environment => REFUSE');
withFail({ slateShaNow: 'f'.repeat(64) }, 'D:', 'E(brief): candidate slate pre-modified => REFUSE before any write');
withFail({ completionMarkerExists: true }, 'E:', 'F(brief): prior completion marker => single-use authorization is spent => REFUSE');
{
  const r = evaluateExecutionPreconditions(GOOD);
  ok(r.allowed === true && r.failures.length === 0, 'G(brief): fully valid mocked execution state => WOULD_EXECUTE (DRY_RUN_PASS)');
}
withFail({ supervisedMode: false }, 'SUPERVISION:', 'H(brief): ordinary/CI invocation (no supervised mode) => never executes');

// ── additional fail-closed branches ──────────────────────────────────────
withFail({ authRecords: [{ name: 'a.json', record: AUTH }, { name: 'b.json', record: AUTH }] }, 'C:', 'X1: conflicting authorizations => REFUSE');
withFail({ blockedRecordsPresent: true }, 'F:', 'X2: an INTAKE_BLOCKED record supersedes the gate => REFUSE');
withFail({ methodologySha: 'a'.repeat(64) }, 'B:', 'X3: pinned methodology hash drift voids the authorization');
withFail({ readinessAggregate: null }, 'H:', 'X4: unverified readiness (no live run in this environment) => REFUSE');
{
  const bad = JSON.parse(JSON.stringify(AUTH)); bad.authorized = false;
  const r = evaluateExecutionPreconditions({ ...GOOD, authRecords: [{ name: 'x', record: bad }] });
  ok(!r.allowed, 'X5: authorized:false record grants nothing');
}

// ── supervised invocation mechanics ──────────────────────────────────────
ok(supervisedModeRequested([SUPERVISED_FLAG], { [SUPERVISED_ENV]: SUPERVISED_ENV_VALUE }) === true, 'M1: flag + exact owner env marker => supervised');
ok(supervisedModeRequested([SUPERVISED_FLAG], {}) === false, 'M2: flag alone is refused');
ok(supervisedModeRequested([], { [SUPERVISED_ENV]: SUPERVISED_ENV_VALUE }) === false, 'M3: env marker alone is refused');
ok(supervisedModeRequested([SUPERVISED_FLAG], { [SUPERVISED_ENV]: 'true' }) === false, 'M4: generic truthy values ordinary CI might set are refused — exact marker required');

// ── real repo, real runner ───────────────────────────────────────────────
{
  const pre = evaluateFromRepo(ROOT, { nowMs: Date.parse('2026-08-31T00:00:00Z'), env: { TALLY_API_KEY: 'x' }, readinessAggregate: 'READY', supervisedMode: true });
  // POST-SUPERSESSION (v0.3): the recorded methodology-supersession-001.json makes the
  // v0.2-pinned intake-execution-001 UNUSABLE — the ONLY failure must be the S: refusal,
  // proving every other precondition still holds exactly as before.
  ok(pre.allowed === false && (pre.failures || []).length === 1 && /UNUSABLE FOR SUPERSEDED METHODOLOGY/.test(pre.failures[0]), 'R1: real repo state at the cutoff instant is refused SOLELY by the recorded methodology supersession (v0.2 authorization unusable; all other preconditions still satisfied)');
  const pre2 = evaluateFromRepo(ROOT, { nowMs: Date.parse('2026-08-31T00:00:00Z'), env: {}, readinessAggregate: 'READY', supervisedMode: true });
  ok(pre2.allowed === false, 'R2: same instant without the key => refused');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'run-candidate-intake.js')], { encoding: 'utf8' });
  const nowCut = require('./lib/intake-cutoff.js').computeCutoffFromRepo(ROOT);
  ok(nowCut.reached ? r.status === 3 : r.status === 2, `R3: unsupervised CLI right now exits ${nowCut.reached ? '3 (post-cutoff: reports preconditions, never executes)' : '2 (pre-cutoff frozen gate)'}`);
  ok(!/INTAKE RAN/.test(r.stdout), 'R4: no invocation in this suite ever ran the pipeline');
}

console.log(`\nAUTHORIZATION GATE SUITE: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
