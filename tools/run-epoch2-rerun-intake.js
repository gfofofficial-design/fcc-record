#!/usr/bin/env node
// FCC Stage 0 — supervised Epoch 2 C1-C3 rerun entrypoint.
// No cutoff, authorization, readiness, or owner flag can be supplied through an
// imported function: the production gate reads the real process and repository.
'use strict';
const fs = require('fs');
const path = require('path');
const gate = require('./lib/epoch2-rerun-authorization.js');
const completion = require('./lib/epoch2-rerun-completion.js');
const shortage = require('./lib/epoch2-shortage-result.js');
const selected = require('./lib/epoch2-rerun-selected-result.js');
const selection = require('./lib/epoch2-selection.js');
const { buildLiveProvider } = require('./lib/live-acquisition-provider.js');

const ROOT = path.join(__dirname, '..');
function parseRunArg(argv) {
  const values = (argv || []).filter((x) => /^--run=/.test(x)).map((x) => x.slice(6));
  return values.length === 1 && completion.CHECKPOINTS[values[0]] ? values[0] : null;
}

async function main() {
  const run = parseRunArg(process.argv.slice(2));
  if (!run) {
    console.error('EPOCH 2 RERUN REFUSED: supply exactly one --run=C1, --run=C2, or --run=C3');
    process.exit(2);
  }
  const authorization = gate.evaluateRerunForProcess(ROOT, run);
  if (!authorization.executable) {
    console.error(`EPOCH 2 ${run} RERUN REFUSED`);
    for (const failure of authorization.failures || []) console.error(' - ' + failure);
    process.exit(2);
  }

  // The source window is anchored to the frozen checkpoint, never to the wall
  // clock at which a supervised command happens to start.
  const provider = buildLiveProvider({ repoRoot: ROOT, nowMs: Date.parse(authorization.checkpointTimestamp) });
  await provider.collect();
  const result = selection.selectEpoch2(provider.collectRawPool(), {
    cutoff: authorization.checkpointTimestamp,
    aiLintPass: provider.aiLintPass,
    materialRisk: provider.adversaryFlag,
  });
  const completedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const authorizationBytes = fs.readFileSync(path.join(ROOT, completion.authPath(run)));
  const reconciliationBytes = fs.readFileSync(path.join(ROOT, completion.RECONCILIATION_PATH));
  const lineage = shortage.lineageFromRepo(ROOT);

  let document, written;
  if (result.ok) {
    const shellBytes = fs.readFileSync(path.join(ROOT, selected.SHELL_PATH));
    document = selected.buildSelectedSlate({
      run,
      result,
      authorizationSha: selected.sha256(authorizationBytes),
      reconciliationSha: selected.sha256(reconciliationBytes),
      shellSha: selected.sha256(shellBytes),
      lineage,
      completedAt,
    });
    written = selected.executeSelectedWrite(ROOT, run, document);
  } else {
    document = shortage.buildShortageEvent({
      run,
      result,
      authorizationSha: shortage.sha256(authorizationBytes),
      reconciliationSha: shortage.sha256(reconciliationBytes),
      lineage,
      completedAt,
    });
    written = shortage.executeShortageWrite(ROOT, run, document);
  }
  if (!written.ok) {
    console.error(`EPOCH 2 ${run} RESULT PERSISTENCE FAILED: ${written.state}`);
    for (const problem of written.problems || []) console.error(' - ' + problem);
    process.exit(written.state === 'RECONCILIATION_REQUIRED' ? 5 : 4);
  }
  console.log(`EPOCH 2 ${run} ${document.state || 'SELECTED'} RECORDED; AUTHORIZATION SPENT`);
  console.log(`result_sha256=${written.resultSha}`);
}

module.exports = { parseRunArg };
if (require.main === module) main().catch((e) => { console.error('EPOCH 2 RERUN FAILED CLOSED: ' + e.message); process.exit(3); });
