#!/usr/bin/env node
// FCC Stage 0 — CI guard for the C1-C3 rerun namespace.
// CI never invokes readiness, acquisition, or intake. It verifies that C0/002
// is permanently locked and that every visible rerun state fails closed without
// malformed, partial, conflicting, or noncanonical authority artifacts.
'use strict';
const fs = require('fs');
const path = require('path');
const c0 = require('./lib/epoch2-intake-authorization.js');
const rerun = require('./lib/epoch2-rerun-authorization.js');

const ROOT = path.join(__dirname, '..');

function conflictingClaimants(repoRoot) {
  const dir = path.join(repoRoot, 'governance', 'gates');
  const conflicts = [];
  for (const name of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && !x.endsWith('.completed.json'))) {
    let doc = null;
    try { doc = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch (e) { /* malformed canonical files are caught by the gate */ }
    const claims = /^intake-execution-00[3-5].*\.json$/i.test(name) || !!(doc && (doc.gate === 'CANDIDATE_INTAKE_RERUN_EXECUTION' || ['intake-execution-003', 'intake-execution-004', 'intake-execution-005'].includes(doc.authorization_id)));
    const canonical = /^intake-execution-00[3-5]\.json$/.test(name);
    if (claims && !canonical) conflicts.push(name);
  }
  return conflicts;
}

function decide(repoRoot, nowMs = Date.now()) {
  const failures = [];
  if (c0.C0_EXECUTION_PERMANENTLY_CONSUMED !== true) failures.push('historical authorization 002 production lock is absent');
  const claimants = conflictingClaimants(repoRoot);
  if (claimants.length) failures.push('noncanonical rerun authorization claimant(s): ' + claimants.join(', '));
  const runs = ['C1', 'C2', 'C3'].map((run) => rerun.decideRerunGuardCase(repoRoot, run, { nowMs }));
  for (const result of runs) if (!result.pass) failures.push(`${result.caseId}: ${result.why}`);
  return { pass: failures.length === 0, failures, runs };
}

module.exports = { conflictingClaimants, decide };

if (require.main === module) {
  const result = decide(ROOT);
  console.log('=== CI EPOCH 2 RERUN GUARD ===');
  for (const run of result.runs) console.log(`${run.caseId}: ${run.pass ? 'PASS' : 'FAIL'} — ${run.why}`);
  console.log(`C0/002 PERMANENT REUSE LOCK: ${c0.C0_EXECUTION_PERMANENTLY_CONSUMED ? 'PASS' : 'FAIL'}`);
  for (const failure of result.failures) console.error('FAIL ' + failure);
  process.exit(result.pass ? 0 : 1);
}
