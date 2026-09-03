#!/usr/bin/env node
// FCC STAGE 0 — supervised Epoch 2 candidate intake.
// ORDER IS SECURITY-CRITICAL: process-bound authorization and live readiness are
// resolved before the acquisition provider is loaded or any network call occurs.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

async function main() {
  const gateModule = require('./lib/epoch2-intake-authorization.js');
  const gate = gateModule.evaluateEpoch2ForProcess(ROOT);
  if (gate.allowed !== true || gate.executable !== true || gate.production !== true) {
    console.log('=== EPOCH 2 INTAKE REFUSED BEFORE ACQUISITION ===');
    for (const f of gate.failures || []) console.log('  - ' + f);
    process.exitCode = 3; return;
  }

  // Lazy imports after the gate: an unauthorized invocation cannot acquire data.
  const { buildLiveProvider } = require('./lib/live-acquisition-provider.js');
  const select = require('./lib/epoch2-selection.js');
  const writer = require('./lib/epoch2-selected-slate-writer.js');
  const completion = require('./lib/epoch2-completion.js');
  const cutoff = gate.cutoff.cutoffTimestamp;
  const provider = buildLiveProvider({ repoRoot: ROOT, env: process.env, nowMs: Date.parse(cutoff) });
  await provider.collect();
  const acquired = provider.collectRawPool().map((x) => ({ ...x, observableType: x.observableType || ((x.sourceId === 'A1' || x.sourceId === 'A2') && x.resolutionDate ? 'OBS_SOURCE_NATIVE_DATE' : null), materialRisk: provider.adversaryFlag(x) === true }));
  const result = select.selectEpoch2(acquired, { cutoff, aiLintPass: provider.aiLintPass, materialRisk: provider.adversaryFlag });
  if (!result.ok) {
    console.log('=== EPOCH 2 SELECTION DID NOT PRODUCE A WRITABLE SLATE ===');
    console.log(JSON.stringify({ state: result.state, cutoff, observed: acquired.map((x) => ({ source_class: select.SOURCE_CLASS[x.sourceId], source_id: x.sourceId, canonical_id: x.canonicalId, opened_at: x.openedAt })), unsatisfied: result.unsatisfied || [result.state], rerun_schedule: result.rerun_schedule }, null, 2));
    process.exitCode = 4; return;
  }
  const authBytes = fs.readFileSync(path.join(ROOT, completion.AUTH_PATH));
  const shellBytes = fs.readFileSync(path.join(ROOT, completion.SHELL_PATH));
  const completedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const document = writer.buildSelectedSlate({ result, authorizationSha: sha256(authBytes), shellSha: sha256(shellBytes), lineage: writer.lineageFromRepo(ROOT), completedAt });
  const write = writer.executeSelectedSlateWrite(ROOT, document); // re-evaluates the process-bound gate itself
  console.log(JSON.stringify(write, null, 2));
  if (!write.ok) process.exitCode = 5;
}

if (require.main === module) main().catch((e) => { console.error('=== EPOCH 2 INTAKE FAILED CLOSED ===\n' + e.message); process.exitCode = 1; });
module.exports = { main };
