// FCC STAGE 0 — INTAKE EXECUTION AUTHORIZATION GATE.
//
// Machine-verifies every precondition of governance/gates/intake-execution-001.json
// before a supervised candidate-intake execution may proceed. Pure core
// (evaluateExecutionPreconditions) so every branch is testable without waiting
// for the cutoff; thin repo-reading wrapper (evaluateFromRepo) for the runner.
//
// FAIL-CLOSED: any missing, malformed, drifted, conflicting, superseded, or
// unverifiable input is a refusal. Nothing here can start an intake — it can
// only refuse one; the runner additionally requires the supervised invocation
// mode that ordinary CI cannot supply.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { computeCutoffFromRepo } = require('./intake-cutoff.js');

const AUTH_RE = /^intake-execution-\d{3}\.json$/;
const BLOCKED_RE = /^intake-blocked-.*\.json$/;
const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function validateAuthorizationShape(a) {
  const problems = [];
  if (!a || a.artifact_class !== 'GOVERNANCE_EXECUTION_AUTHORIZATION') problems.push('artifact_class');
  if (!a || a.gate !== 'CANDIDATE_INTAKE_EXECUTION') problems.push('gate');
  if (!a || a.authorized !== true) problems.push('authorized');
  if (!a || !a.scope || a.scope.single_use !== true || typeof a.scope.completion_marker_path !== 'string') problems.push('scope.single_use/completion_marker_path');
  const p = a && a.pins;
  if (!p || !/^[0-9a-f]{64}$/.test((p.methodology || {}).sha256 || '')) problems.push('pins.methodology');
  if (!p || !/^[0-9a-f]{64}$/.test((p.experiment_freeze || {}).sha256 || '')) problems.push('pins.experiment_freeze');
  if (!p || !/^[0-9a-f]{64}$/.test(p.pre_intake_candidate_slate_sha256 || '')) problems.push('pins.pre_intake_candidate_slate_sha256');
  if (!p || p.frozen_cutoff !== '2026-08-31T00:00:00.000Z') problems.push('pins.frozen_cutoff');
  return problems;
}

// Pure precondition evaluation — every input injected, every branch testable now.
function evaluateExecutionPreconditions({
  cutoff,                    // result of the frozen formula (defined/reached/cutoffTimestamp)
  authRecords,               // [{name, record}] parsed intake-execution-*.json files
  methodologySha, freezeSha, // actual current hashes of the pinned artifacts
  slateShaNow,               // actual current candidate-slate.json hash
  completionMarkerExists,    // boolean
  blockedRecordsPresent,     // boolean — any intake-blocked-*.json
  tallyKeyPresent,           // boolean (presence only; the value is never handled)
  readinessAggregate,        // 'READY' | 'BLOCKED' | null — from THIS environment's live run
  supervisedMode,            // boolean — explicit flag + owner env marker
}) {
  const failures = [];
  if (!cutoff || cutoff.defined !== true || cutoff.reached !== true) failures.push('A: frozen cutoff not reached — execution prohibited before ' + (cutoff && cutoff.cutoffTimestamp));
  const valid = (authRecords || []).filter((r) => validateAuthorizationShape(r.record).length === 0);
  if (valid.length === 0) failures.push('B: no valid CANDIDATE_INTAKE_EXECUTION authorization record exists');
  if (valid.length > 1) failures.push('C: conflicting authorization records exist (' + valid.map((r) => r.name).join(', ') + ')');
  const auth = valid.length === 1 ? valid[0].record : null;
  if (auth) {
    if (auth.pins.methodology.sha256 !== methodologySha) failures.push('B: pinned methodology hash does not match the repository — authorization void');
    if (auth.pins.experiment_freeze.sha256 !== freezeSha) failures.push('B: pinned experiment-freeze hash does not match the repository — authorization void');
    if (cutoff && cutoff.defined && auth.pins.frozen_cutoff !== cutoff.cutoffTimestamp) failures.push('B: pinned cutoff does not equal the frozen formula output — authorization void');
    if (auth.pins.pre_intake_candidate_slate_sha256 !== slateShaNow) failures.push('D: candidate-slate.json no longer matches the pinned pre-intake hash — slate was touched, STOP');
    if (completionMarkerExists) failures.push('E: completion marker exists — this single-use authorization is spent; a new ratified authorization is required');
  }
  if (blockedRecordsPresent) failures.push('F: an INTAKE_BLOCKED record exists and supersedes this gate — a new ratified gate is required');
  if (!tallyKeyPresent) failures.push('G: TALLY_API_KEY not present in the process environment (frozen A2 requirement; the key itself is never stored or logged)');
  if (readinessAggregate !== 'READY') failures.push('H: live acquisition readiness in THIS environment is ' + (readinessAggregate || 'UNVERIFIED') + ' — must be READY, including live B2 verification here');
  if (!supervisedMode) failures.push('SUPERVISION: explicit supervised invocation mode absent — ordinary/CI invocation never executes intake');
  return { allowed: failures.length === 0, failures, authorization: auth };
}

function evaluateFromRepo(repoRoot, { nowMs, env, readinessAggregate, supervisedMode } = {}) {
  const gates = path.join(repoRoot, 'governance', 'gates');
  const expDir = path.join(repoRoot, 'governance', 'experiments', 'stage0-public-experiment-v1');
  const names = fs.existsSync(gates) ? fs.readdirSync(gates) : [];
  const authRecords = [];
  for (const n of names.filter((n) => AUTH_RE.test(n))) {
    try { authRecords.push({ name: n, record: JSON.parse(fs.readFileSync(path.join(gates, n), 'utf8')) }); } catch (e) { /* malformed = not valid */ }
  }
  const marker = authRecords.length === 1 && authRecords[0].record && authRecords[0].record.scope && authRecords[0].record.scope.completion_marker_path
    ? path.join(repoRoot, authRecords[0].record.scope.completion_marker_path)
    : path.join(gates, 'intake-execution-001.completed.json');
  return evaluateExecutionPreconditions({
    cutoff: computeCutoffFromRepo(repoRoot, nowMs),
    authRecords,
    methodologySha: sha256File(path.join(expDir, 'FCC_STAGE0_CANDIDATE_SELECTION_METHOD_V0_2.md')),
    freezeSha: sha256File(path.join(expDir, 'experiment-freeze.json')),
    slateShaNow: sha256File(path.join(expDir, 'candidate-slate.json')),
    completionMarkerExists: fs.existsSync(marker),
    blockedRecordsPresent: names.some((n) => BLOCKED_RE.test(n)),
    tallyKeyPresent: !!(env || process.env).TALLY_API_KEY,
    readinessAggregate: readinessAggregate || null,
    supervisedMode: supervisedMode === true,
  });
}

// Supervised invocation: BOTH an explicit CLI flag AND an owner-set environment
// marker with an exact value ordinary CI never sets. Either alone is refused.
const SUPERVISED_FLAG = '--execute-intake-supervised';
const SUPERVISED_ENV = 'FCC_SUPERVISED_INTAKE';
const SUPERVISED_ENV_VALUE = 'OWNER-PRESENT';
function supervisedModeRequested(argv, env) {
  return argv.includes(SUPERVISED_FLAG) && (env || process.env)[SUPERVISED_ENV] === SUPERVISED_ENV_VALUE;
}

module.exports = { evaluateExecutionPreconditions, evaluateFromRepo, validateAuthorizationShape, supervisedModeRequested, SUPERVISED_FLAG, SUPERVISED_ENV, SUPERVISED_ENV_VALUE };
