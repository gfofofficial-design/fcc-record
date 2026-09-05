// FCC Stage 0 — Epoch 2 C1-C3 completion marker builder/verifier.
//
// A rerun authorization is consumed by either a selected slate or a shortage
// event.  Both outcomes use this same marker shape so neither branch can return
// before durable, byte-verified evidence identifies the exact execution HEAD
// and readiness transaction.
'use strict';
const crypto = require('crypto');

const CHECKPOINTS = Object.freeze({
  C1: { authorization: 'intake-execution-003', timestamp: '2026-09-10T00:00:00.000Z' },
  C2: { authorization: 'intake-execution-004', timestamp: '2026-09-17T00:00:00.000Z' },
  C3: { authorization: 'intake-execution-005', timestamp: '2026-09-24T00:00:00.000Z' },
});
const RECONCILIATION_PATH = 'governance/gates/epoch2-c0-shortage-reconciliation-001.json';
const EXP_DIR = 'governance/experiments/stage0-public-experiment-v1';
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UTC_SEC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const authPath = (run) => `governance/gates/${CHECKPOINTS[run].authorization}.json`;
const markerPath = (run) => `governance/gates/${CHECKPOINTS[run].authorization}.completed.json`;
const selectedPath = (run) => `${EXP_DIR}/candidate-slate.v2.${run.toLowerCase()}.selected.json`;
const shortagePath = (run) => `${EXP_DIR}/epoch2-${run.toLowerCase()}-shortage-event.json`;
const resultPath = (run, outcome) => outcome === 'SELECTED' ? selectedPath(run) : shortagePath(run);

function buildCompletionMarker({ run, outcome, completedAt, resultBytes, authorizationBytes, reconciliationBytes, executionHead, readinessOutputSha256 }) {
  const cp = CHECKPOINTS[run];
  if (!cp) throw new Error('run must be C1, C2, or C3');
  if (!['SELECTED', 'SHORTAGE_EVENT', 'DIFFICULTY_QUOTA_UNSATISFIED'].includes(outcome)) throw new Error('unknown rerun outcome');
  return {
    artifact_class: 'GOVERNANCE_EXECUTION_COMPLETION',
    not_a_capital_instrument: true,
    gate: 'CANDIDATE_INTAKE_RERUN_EXECUTION',
    authorization_id: cp.authorization,
    epoch: 2,
    run,
    outcome,
    completed_at: completedAt,
    single_use_consumed: true,
    result_artifact: { path: resultPath(run, outcome), sha256: sha256(resultBytes) },
    authorization_record: { path: authPath(run), sha256: sha256(authorizationBytes) },
    c0_reconciliation_record: { path: RECONCILIATION_PATH, sha256: sha256(reconciliationBytes) },
    checkpoint_timestamp: cp.timestamp,
    execution_head: executionHead,
    readiness_output_sha256: readinessOutputSha256,
  };
}

function validateCompletionMarker(marker, { run, outcome, completedAt, resultBytes, authorizationBytes, reconciliationBytes, executionHead, readinessOutputSha256 }) {
  const problems = [], d = marker || {}, cp = CHECKPOINTS[run];
  const keys = ['artifact_class', 'not_a_capital_instrument', 'gate', 'authorization_id', 'epoch', 'run', 'outcome', 'completed_at', 'single_use_consumed', 'result_artifact', 'authorization_record', 'c0_reconciliation_record', 'checkpoint_timestamp', 'execution_head', 'readiness_output_sha256'];
  for (const k of keys) if (!(k in d)) problems.push('missing ' + k);
  for (const k of Object.keys(d)) if (!keys.includes(k)) problems.push('unexpected ' + k);
  if (!cp) problems.push('unknown run');
  if (d.artifact_class !== 'GOVERNANCE_EXECUTION_COMPLETION' || d.not_a_capital_instrument !== true || d.gate !== 'CANDIDATE_INTAKE_RERUN_EXECUTION' || d.epoch !== 2) problems.push('completion identity');
  if (!cp || d.authorization_id !== cp.authorization || d.run !== run || d.checkpoint_timestamp !== cp.timestamp) problems.push('run binding');
  if (d.outcome !== outcome || !['SELECTED', 'SHORTAGE_EVENT', 'DIFFICULTY_QUOTA_UNSATISFIED'].includes(d.outcome)) problems.push('outcome binding');
  if (d.completed_at !== completedAt || !UTC_SEC.test(d.completed_at || '') || Number.isNaN(Date.parse(d.completed_at))) problems.push('completed_at');
  if (d.single_use_consumed !== true) problems.push('single_use_consumed');
  const bound = (obj, expectedPath, bytes, label) => {
    if (!obj || Object.keys(obj).sort().join(',') !== 'path,sha256' || obj.path !== expectedPath || obj.sha256 !== sha256(bytes)) problems.push(label);
  };
  if (cp) {
    bound(d.result_artifact, resultPath(run, outcome), resultBytes, 'result_artifact');
    bound(d.authorization_record, authPath(run), authorizationBytes, 'authorization_record');
    bound(d.c0_reconciliation_record, RECONCILIATION_PATH, reconciliationBytes, 'c0_reconciliation_record');
  }
  if (!HEX40.test(executionHead || '') || d.execution_head !== executionHead) problems.push('execution_head');
  if (!HEX64.test(readinessOutputSha256 || '') || d.readiness_output_sha256 !== readinessOutputSha256) problems.push('readiness_output_sha256');
  return { valid: problems.length === 0, problems };
}

module.exports = { CHECKPOINTS, RECONCILIATION_PATH, sha256, authPath, markerPath, selectedPath, shortagePath, resultPath, buildCompletionMarker, validateCompletionMarker };
