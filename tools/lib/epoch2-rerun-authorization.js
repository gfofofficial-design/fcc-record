// FCC Stage 0 — Epoch 2 C1-C3 process-bound rerun authorization gate.
//
// This module is additive to the historical C0/002 gate. It requires the C0
// reconciliation, one run-specific owner authorization, exact reviewed public
// infrastructure pins, the frozen checkpoint, a clean HEAD-bound live readiness
// transaction, and a completely unused result namespace. Nothing here performs
// acquisition or writes an artifact.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const canonicalize = require('canonicalize');
const completion = require('./epoch2-rerun-completion.js');
const probe = require('./epoch2-rerun-readiness-probe.js');
const { supervisedModeRequested, SUPERVISED_FLAG, SUPERVISED_ENV, SUPERVISED_ENV_VALUE } = require('./intake-authorization.js');

const C0_AUTH_PATH = 'governance/gates/intake-execution-002.json';
const SHELL_PATH = 'governance/experiments/stage0-public-experiment-v1/candidate-slate.v2.json';
const C0_CUTOFF = '2026-09-03T00:00:00.000Z';
const HEX64 = /^[0-9a-f]{64}$/;
const UTC_SEC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const NON_AUTHORITY = /\bDRAFT\b|\bPENDING\b|\bUNSIGNED\b|\bUNAUTHORIZED\b|NOT[_ ]AUTHORIZED|TO_BE_|WITHHELD|PLACEHOLDER/i;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const lineagePaths = Object.freeze({
  methodology: 'governance/experiments/stage0-public-experiment-v1/FCC_STAGE0_CANDIDATE_SELECTION_METHOD_V0_3.md',
  experiment_spec: 'governance/experiments/stage0-public-experiment-v1/FCC_STAGE0_PUBLIC_EXPERIMENT_SPEC_V0_3.md',
  experiment_freeze: 'governance/experiments/stage0-public-experiment-v1/experiment-freeze.v2.json',
  pre_intake_candidate_slate: SHELL_PATH,
  supersession_record: 'governance/gates/methodology-supersession-001.json',
});
const REQUIRED_INFRASTRUCTURE = Object.freeze({
  readiness_verifier: 'tools/verify-acquisition-readiness.js',
  acquisition_adapters: 'tools/lib/acquisition-adapters.js',
  live_acquisition_provider: 'tools/lib/live-acquisition-provider.js',
  deterministic_selection: 'tools/lib/epoch2-selection.js',
  shortage_event_schema: 'governance/schemas/v2/epoch2-shortage-event.schema.json',
  rerun_selected_schema: 'governance/schemas/v2/candidate-slate.v2.rerun-selected.schema.json',
  completion_marker_writer_verifier: 'tools/lib/epoch2-rerun-completion.js',
  shortage_result_writer: 'tools/lib/epoch2-shortage-result.js',
  selected_result_writer: 'tools/lib/epoch2-rerun-selected-result.js',
  rerun_authorization_gate: 'tools/lib/epoch2-rerun-authorization.js',
  rerun_readiness_transaction: 'tools/lib/epoch2-rerun-readiness-probe.js',
  rerun_runner: 'tools/run-epoch2-rerun-intake.js',
  ci_rerun_guard: 'tools/ci-epoch2-rerun-guard.js',
});

function readBytes(repoRoot, rel) { try { return fs.readFileSync(path.join(repoRoot, rel)); } catch (e) { return null; } }
function readJson(repoRoot, rel) {
  const bytes = readBytes(repoRoot, rel);
  if (!bytes) return { exists: false, bytes: null, doc: null, error: null };
  try { return { exists: true, bytes, doc: JSON.parse(bytes), error: null }; }
  catch (e) { return { exists: true, bytes, doc: null, error: e.message }; }
}
function realUtcSec(s) { return UTC_SEC.test(s || '') && !Number.isNaN(Date.parse(s)) && new Date(Date.parse(s)).toISOString().replace(/\.000Z$/, 'Z') === s; }
function stringsOf(v, out = []) { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => stringsOf(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => stringsOf(x, out)); return out; }
function exactKeys(obj, keys, label, problems) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { problems.push(label + ' missing'); return; }
  const expected = keys.slice().sort().join(','), actual = Object.keys(obj).sort().join(',');
  if (actual !== expected) problems.push(label + ' keys are not exact');
}

function validateC0Reconciliation(repoRoot, record, nowMs = Date.now()) {
  const p = [], d = record.doc;
  if (!record.exists) return ['C0 reconciliation record is absent'];
  if (!d) return ['C0 reconciliation is malformed JSON'];
  if (d._DRAFT_NOTICE !== undefined || stringsOf(d).some((s) => NON_AUTHORITY.test(s))) p.push('C0 reconciliation still carries draft/non-authority wording');
  if (d.artifact_class !== 'GOVERNANCE_EXECUTION_RECONCILIATION' || d.not_a_capital_instrument !== true || d.record_id !== 'epoch2-c0-shortage-reconciliation-001' || d.epoch !== 2 || d.run !== 'C0' || d.authorization_id !== 'intake-execution-002') p.push('C0 reconciliation identity');
  const c0Auth = readBytes(repoRoot, C0_AUTH_PATH);
  if (!c0Auth || !d.authorization_record || d.authorization_record.path !== C0_AUTH_PATH || d.authorization_record.sha256 !== sha256(c0Auth)) p.push('C0 reconciliation authorization binding');
  if (!d.observed_outcome || d.observed_outcome.state !== 'SHORTAGE_EVENT' || d.observed_outcome.selected_slate_written !== false || d.observed_outcome.completion_marker_written !== false || d.observed_outcome.capital_activity_occurred !== false) p.push('C0 shortage outcome');
  if (!d.authorization_disposition || d.authorization_disposition.single_use_consumed_conservatively !== true || d.authorization_disposition.reuse_prohibited !== true || d.authorization_disposition.c1_authorized_here !== false) p.push('C0 authorization disposition');
  if (!d.evidence_limitation || d.evidence_limitation.classification !== 'RUNNER_OUTPUT_PERSISTENCE_DEFECT' || !/does not reconstruct or fabricate/i.test(d.evidence_limitation.statement || '')) p.push('C0 evidence limitation');
  if (!d.owner_authorization || d.owner_authorization.state !== 'OWNER_AUTHORIZED_RECONCILIATION' || !realUtcSec(d.owner_authorization.authorized_at)) p.push('C0 reconciliation owner authorization');
  if (!realUtcSec(d.recorded_at) || Date.parse(d.owner_authorization && d.owner_authorization.authorized_at) > Date.parse(d.recorded_at) || Date.parse(d.recorded_at) > nowMs || d.owner_ratification_required !== false) p.push('C0 reconciliation chronology/finality');
  if (d.cutoff !== C0_CUTOFF || !/^[0-9a-f]{40}$/.test(d.execution_head || '')) p.push('C0 cutoff/execution HEAD');
  const schedule = Object.entries(completion.CHECKPOINTS).map(([run, cp], i) => ({ run, days_after_c0: (i + 1) * 7, timestamp: cp.timestamp }));
  if (canonicalize(d.frozen_rerun_schedule || []) !== canonicalize(schedule)) p.push('C0 frozen rerun schedule');
  return p;
}

function validatePin(repoRoot, pin, expectedPath, label, problems) {
  exactKeys(pin, ['path', 'sha256'], label, problems);
  if (!pin || pin.path !== expectedPath || !HEX64.test(pin.sha256 || '')) { problems.push(label + ' path/hash'); return; }
  const bytes = readBytes(repoRoot, expectedPath);
  if (!bytes || sha256(bytes) !== pin.sha256) problems.push(label + ' bytes differ from pin');
}

function validateAuthorization(repoRoot, run, record, reconciliation, nowMs) {
  const p = [], d = record.doc, cp = completion.CHECKPOINTS[run];
  if (!record.exists) return [`${cp.authorization}.json is absent`];
  if (!d) return [`${cp.authorization}.json is malformed JSON`];
  exactKeys(d, ['artifact_class', 'not_a_capital_instrument', 'gate', 'authorization_id', 'authorized', 'epoch', 'run', 'scheduled_not_before', 'predecessor', 'scope', 'pins', 'owner_authorization', 'recorded_at', 'owner_ratification_required'], 'authorization', p);
  if (stringsOf(d).some((s) => NON_AUTHORITY.test(s))) p.push('authorization carries draft/non-authority wording');
  if (d.artifact_class !== 'GOVERNANCE_EXECUTION_AUTHORIZATION' || d.not_a_capital_instrument !== true || d.gate !== 'CANDIDATE_INTAKE_RERUN_EXECUTION' || d.authorization_id !== cp.authorization || d.authorized !== true || d.epoch !== 2 || d.run !== run || d.scheduled_not_before !== cp.timestamp || d.owner_ratification_required !== false) p.push('authorization identity/schedule');
  exactKeys(d.predecessor, ['authorization', 'required_disposition', 'reconciliation_record'], 'predecessor', p);
  if (!d.predecessor || d.predecessor.authorization !== C0_AUTH_PATH || d.predecessor.required_disposition !== 'CONSUMED_BY_C0_SHORTAGE_ATTEMPT' || d.predecessor.reconciliation_record !== completion.RECONCILIATION_PATH) p.push('predecessor boundary');
  exactKeys(d.scope, ['what_is_authorized', 'single_use', 'completion_marker_path', 'may_reuse_intake_execution_002', 'may_change_sources_or_thresholds', 'may_create_capital_activity'], 'scope', p);
  const expectedScope = `EXACTLY ONE supervised Epoch 2 ${run} candidate-intake rerun`;
  if (!d.scope || d.scope.what_is_authorized !== expectedScope || d.scope.single_use !== true || d.scope.completion_marker_path !== completion.markerPath(run) || d.scope.may_reuse_intake_execution_002 !== false || d.scope.may_change_sources_or_thresholds !== false || d.scope.may_create_capital_activity !== false) p.push('authorization scope');
  exactKeys(d.owner_authorization, ['state', 'authorized_at', 'scope'], 'owner_authorization', p);
  if (!d.owner_authorization || d.owner_authorization.state !== 'OWNER_AUTHORIZED_EXECUTION' || d.owner_authorization.scope !== expectedScope || !realUtcSec(d.owner_authorization.authorized_at)) p.push('owner authorization');
  if (!realUtcSec(d.recorded_at) || Date.parse(d.owner_authorization && d.owner_authorization.authorized_at) > Date.parse(d.recorded_at) || Date.parse(d.recorded_at) > nowMs) p.push('authorization chronology');
  exactKeys(d.pins, [...Object.keys(lineagePaths), 'c0_reconciliation', 'frozen_c0_cutoff', 'checkpoint_timestamp', 'execution_infrastructure'], 'pins', p);
  for (const [key, rel] of Object.entries(lineagePaths)) validatePin(repoRoot, d.pins && d.pins[key], rel, 'pins.' + key, p);
  validatePin(repoRoot, d.pins && d.pins.c0_reconciliation, completion.RECONCILIATION_PATH, 'pins.c0_reconciliation', p);
  if (!d.pins || d.pins.frozen_c0_cutoff !== C0_CUTOFF || d.pins.checkpoint_timestamp !== cp.timestamp) p.push('frozen cutoff/checkpoint pins');
  const infra = d.pins && d.pins.execution_infrastructure;
  exactKeys(infra, ['public_commit', 'files'], 'execution_infrastructure', p);
  if (!infra || !/^[0-9a-f]{40}$/.test(infra.public_commit || '')) p.push('execution_infrastructure.public_commit');
  exactKeys(infra && infra.files, Object.keys(REQUIRED_INFRASTRUCTURE), 'execution_infrastructure.files', p);
  for (const [key, rel] of Object.entries(REQUIRED_INFRASTRUCTURE)) validatePin(repoRoot, infra && infra.files && infra.files[key], rel, `execution_infrastructure.files.${key}`, p);
  if (!reconciliation.bytes || !d.pins || !d.pins.c0_reconciliation || d.pins.c0_reconciliation.sha256 !== sha256(reconciliation.bytes)) p.push('authorization does not bind current C0 reconciliation bytes');
  return p;
}

function validateExistingOutcome(repoRoot, run, facts) {
  const p = [], marker = facts.marker, selected = facts.selected, shortage = facts.shortage;
  if (!marker.exists && !selected.exists && !shortage.exists) return { state: 'UNUSED', problems: [] };
  if (!marker.exists || !marker.doc) return { state: 'RECONCILIATION_REQUIRED', problems: ['result exists without a readable completion marker'] };
  const expected = marker.doc.outcome === 'SELECTED' ? selected : shortage;
  const other = marker.doc.outcome === 'SELECTED' ? shortage : selected;
  if (!expected.exists || other.exists) p.push('completion marker/result namespace mismatch');
  if (!facts.authorization.bytes || !facts.reconciliation.bytes || !expected.bytes) p.push('completion dependencies missing');
  if (!p.length) {
    const v = completion.validateCompletionMarker(marker.doc, {
      run,
      outcome: marker.doc.outcome,
      completedAt: marker.doc.completed_at,
      resultBytes: expected.bytes,
      authorizationBytes: facts.authorization.bytes,
      reconciliationBytes: facts.reconciliation.bytes,
      executionHead: marker.doc.execution_head,
      readinessOutputSha256: marker.doc.readiness_output_sha256,
    });
    p.push(...v.problems);
    if (!p.length) {
      let doc;
      try { doc = JSON.parse(expected.bytes); } catch (e) { p.push('result artifact is malformed JSON'); }
      if (doc) {
        const resultValidation = marker.doc.outcome === 'SELECTED'
          ? require('./epoch2-rerun-selected-result.js').validateSelectedSlate(repoRoot, doc)
          : require('./epoch2-shortage-result.js').validateShortageEvent(repoRoot, doc);
        if (!resultValidation.valid) p.push('result artifact failed schema/semantic verification: ' + resultValidation.problems.join(' | '));
      }
    }
  }
  return { state: p.length ? 'RECONCILIATION_REQUIRED' : 'SPENT', problems: p, outcome: marker.doc.outcome };
}

function readFacts(repoRoot, run) {
  return {
    reconciliation: readJson(repoRoot, completion.RECONCILIATION_PATH),
    authorization: readJson(repoRoot, completion.authPath(run)),
    marker: readJson(repoRoot, completion.markerPath(run)),
    selected: readJson(repoRoot, completion.selectedPath(run)),
    shortage: readJson(repoRoot, completion.shortagePath(run)),
  };
}

function previousRun(run) { return run === 'C2' ? 'C1' : run === 'C3' ? 'C2' : null; }

function evaluateRerunFromRepo(repoRoot, run, { nowMs = Date.now(), supervisedMode = false, readinessAggregate = null } = {}) {
  const cp = completion.CHECKPOINTS[run];
  if (!cp) return { allowed: false, failures: ['RUN: run must be C1, C2, or C3'], run, checkpointTimestamp: null };
  const facts = readFacts(repoRoot, run), failures = [];
  failures.push(...validateC0Reconciliation(repoRoot, facts.reconciliation, nowMs).map((x) => 'C0: ' + x));
  if (nowMs < Date.parse(cp.timestamp)) failures.push(`TIME: ${run} checkpoint ${cp.timestamp} has not been reached`);
  failures.push(...validateAuthorization(repoRoot, run, facts.authorization, facts.reconciliation, nowMs).map((x) => 'AUTH: ' + x));
  const current = validateExistingOutcome(repoRoot, run, facts);
  if (current.state === 'SPENT') failures.push(`SPENT: ${cp.authorization} is permanently consumed by ${current.outcome}`);
  if (current.state === 'RECONCILIATION_REQUIRED') failures.push('STATE: RECONCILIATION_REQUIRED — ' + current.problems.join(' | '));
  const prev = previousRun(run);
  if (prev) {
    const previousFacts = readFacts(repoRoot, prev);
    const previous = validateExistingOutcome(repoRoot, prev, previousFacts);
    if (previous.state !== 'SPENT' || !['SHORTAGE_EVENT', 'DIFFICULTY_QUOTA_UNSATISFIED'].includes(previous.outcome)) failures.push(`PREVIOUS: ${prev} must have a valid shortage completion before ${run}`);
  }
  if (supervisedMode !== true) failures.push(`M: supervised mode required (${SUPERVISED_FLAG} AND ${SUPERVISED_ENV}=${SUPERVISED_ENV_VALUE})`);
  if (readinessAggregate !== 'READY') failures.push('R: live acquisition readiness in this environment must be READY');
  return { allowed: failures.length === 0, failures, run, checkpointTimestamp: cp.timestamp, facts };
}

function infrastructurePinMap(authorization) {
  const files = authorization && authorization.doc && authorization.doc.pins && authorization.doc.pins.execution_infrastructure && authorization.doc.pins.execution_infrastructure.files;
  const out = {};
  for (const pin of Object.values(files || {})) if (pin && typeof pin.path === 'string') out[pin.path] = pin.sha256;
  return out;
}

function evaluateRerunForProcess(repoRoot, run) {
  const supervised = supervisedModeRequested(process.argv.slice(2), process.env);
  const pre = evaluateRerunFromRepo(repoRoot, run, { supervisedMode: supervised, readinessAggregate: null });
  const nonRuntime = pre.failures.filter((f) => !/^R: /.test(f));
  if (nonRuntime.length) return { ...pre, executable: false, production: true, executionHead: null, readinessOutputSha256: null, note: 'refused before live readiness because a non-runtime prerequisite failed' };
  const readiness = probe.runReadinessProbe(repoRoot);
  const head = probe.currentHead(repoRoot), now = Date.now();
  const provenance = probe.validateReadinessProvenance(readiness, { nowMs: now, headSha: head });
  const result = evaluateRerunFromRepo(repoRoot, run, { nowMs: now, supervisedMode: supervised, readinessAggregate: provenance.valid ? provenance.aggregate : null });
  const auth = result.facts.authorization;
  const infra = auth.doc && auth.doc.pins && auth.doc.pins.execution_infrastructure;
  const publicPins = probe.verifyPinnedCommit(repoRoot, infra && infra.public_commit, infrastructurePinMap(auth));
  if (!provenance.valid) result.failures.push('R-PROVENANCE: ' + provenance.problems.join(' | '));
  if (!publicPins.valid) result.failures.push('PINS: ' + publicPins.problems.join(' | '));
  result.allowed = result.failures.length === 0;
  return {
    ...result,
    executable: result.allowed && provenance.valid && publicPins.valid,
    production: true,
    executionHead: readiness.head_after,
    readinessOutputSha256: readiness.output_sha256,
    readinessProvenance: provenance,
    publicPinVerification: publicPins,
  };
}

function decideRerunGuardCase(repoRoot, run = 'C1', { nowMs = Date.now() } = {}) {
  const r = evaluateRerunFromRepo(repoRoot, run, { nowMs, supervisedMode: false, readinessAggregate: null });
  const lawful = r.failures.filter((f) => /^C0: C0 reconciliation record is absent$/.test(f) || /^AUTH: intake-execution-\d{3}\.json is absent$/.test(f) || /^TIME: /.test(f) || /^M: /.test(f) || /^R: /.test(f) || /^SPENT: /.test(f) || /^PREVIOUS: /.test(f));
  const integrity = r.failures.filter((f) => !lawful.includes(f));
  return { pass: integrity.length === 0, caseId: `E2-${run}`, why: integrity.length ? integrity.join(' | ') : `CI never executes rerun intake; ${run} is fail-closed (${lawful.map((x) => x.split(':')[0]).join(',') || 'no runtime authority'})` };
}

module.exports = { C0_AUTH_PATH, SHELL_PATH, C0_CUTOFF, lineagePaths, REQUIRED_INFRASTRUCTURE, sha256, readFacts, validateC0Reconciliation, validateAuthorization, validateExistingOutcome, evaluateRerunFromRepo, evaluateRerunForProcess, decideRerunGuardCase, infrastructurePinMap, supervisedModeRequested, SUPERVISED_FLAG, SUPERVISED_ENV, SUPERVISED_ENV_VALUE,
  __testOnly: { test_only: true, readJson, realUtcSec, exactKeys, previousRun } };
