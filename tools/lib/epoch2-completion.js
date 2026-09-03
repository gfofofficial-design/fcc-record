// FCC STAGE 0 — Epoch 2 completion-marker builder/verifier.
// The marker is created only after the selected artifact has been written,
// read back byte-for-byte and schema/semantic verified by the writer.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SELECTED_PATH = 'governance/experiments/stage0-public-experiment-v1/candidate-slate.v2.selected.json';
const AUTH_PATH = 'governance/gates/intake-execution-002.json';
const MARKER_PATH = 'governance/gates/intake-execution-002.completed.json';
const SHELL_PATH = 'governance/experiments/stage0-public-experiment-v1/candidate-slate.v2.json';
const HEX64 = /^[0-9a-f]{64}$/;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const utcSec = (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s || '') && !Number.isNaN(Date.parse(s)) && new Date(Date.parse(s)).toISOString().replace('.000Z', 'Z') === s;

function buildCompletionMarker({ completedAt, selectedSha, authorizationSha, cutoff, shellSha, lineage }) {
  return {
    artifact_class: 'GOVERNANCE_EXECUTION_COMPLETION',
    not_a_capital_instrument: true,
    gate: 'CANDIDATE_INTAKE_EXECUTION',
    authorization_id: 'intake-execution-002',
    completed_at: completedAt,
    single_use_consumed: true,
    selected_slate: { path: SELECTED_PATH, sha256: selectedSha },
    authorization_record: { path: AUTH_PATH, sha256: authorizationSha },
    cutoff,
    pristine_shell: { path: SHELL_PATH, sha256: shellSha },
    lineage: { ...lineage },
  };
}

function validateCompletionMarker(marker, { selectedBytes, authorizationBytes, shellBytes, cutoff, lineage, nowMs }) {
  const p = [], d = marker || {};
  if (d.artifact_class !== 'GOVERNANCE_EXECUTION_COMPLETION') p.push('artifact_class');
  if (d.not_a_capital_instrument !== true) p.push('not_a_capital_instrument');
  if (d.gate !== 'CANDIDATE_INTAKE_EXECUTION' || d.authorization_id !== 'intake-execution-002') p.push('gate/authorization_id');
  if (!utcSec(d.completed_at)) p.push('completed_at');
  else if (typeof nowMs === 'number' && Date.parse(d.completed_at) > nowMs) p.push('completed_at in future');
  if (d.single_use_consumed !== true) p.push('single_use_consumed');
  const bind = (actual, obj, expectedPath, label) => {
    if (!obj || obj.path !== expectedPath || !HEX64.test(obj.sha256 || '')) p.push(label);
    else if (!actual || sha256(actual) !== obj.sha256) p.push(label + ' hash drift');
  };
  bind(selectedBytes, d.selected_slate, SELECTED_PATH, 'selected_slate');
  bind(authorizationBytes, d.authorization_record, AUTH_PATH, 'authorization_record');
  bind(shellBytes, d.pristine_shell, SHELL_PATH, 'pristine_shell');
  if (d.cutoff !== cutoff) p.push('cutoff');
  for (const k of ['methodology', 'experiment_spec', 'experiment_freeze', 'supersession_record']) {
    if (!d.lineage || !HEX64.test(d.lineage[k] || '') || !lineage || d.lineage[k] !== lineage[k]) p.push('lineage.' + k);
  }
  return { valid: p.length === 0, problems: p };
}

function writeMarkerOnce(repoRoot, marker) {
  const target = path.join(repoRoot, MARKER_PATH);
  const bytes = Buffer.from(JSON.stringify(marker, null, 2) + '\n');
  const fd = fs.openSync(target, 'wx', 0o644);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const reread = fs.readFileSync(target);
  if (!reread.equals(bytes)) throw new Error('completion marker read-back mismatch — RECONCILIATION_REQUIRED');
  return { path: MARKER_PATH, sha256: sha256(reread), bytes: reread };
}

module.exports = { SELECTED_PATH, AUTH_PATH, MARKER_PATH, SHELL_PATH, sha256, buildCompletionMarker, validateCompletionMarker, writeMarkerOnce };
