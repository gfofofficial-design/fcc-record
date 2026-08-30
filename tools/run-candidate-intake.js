#!/usr/bin/env node
// BUILD 04.1 — CANDIDATE INTAKE PRODUCTION ENTRY POINT.
//
// THIS IS THE ONLY ENTRY POINT THAT MAY EVER RUN A REAL INTAKE PASS.
// It is structurally gated: runIntake() calls computeCutoffFromRepo() FIRST,
// and throws before touching any acquisition adapter, any pipeline function,
// or writing candidate-slate.json if authorization is false. There is no
// parameter, flag, or override to skip this gate -- mirroring the BUILD 03
// P4 pattern (persistent hold gate before any canonicalization).
//
// Live network acquisition adapters (the real Snapshot/EDGAR/L2BEAT/etc. HTTP
// calls per section 1.5 of the ratified methodology) are NOT implemented in
// this pass -- intake is not authorized to run yet, so building untested live
// adapters now would be dead, unverifiable code. adapters.js exports the
// REQUIRED INTERFACE and only a deterministic mock implementation, exactly as
// BUILD 03 did for witness transports before AD-3 activation.
const path = require('path');
const fs = require('fs');
const { computeCutoffFromRepo } = require('./lib/intake-cutoff.js');
const intake = require('./lib/candidate-intake.js');

const ROOT = path.join(__dirname, '..');

function runIntake({ repoRoot = ROOT, adapters, nowMs, dryRun = true } = {}) {
  // ── THE GATE — first and unconditional ──────────────────────────────
  const cutoff = computeCutoffFromRepo(repoRoot, nowMs);
  if (!cutoff.authorized) {
    const err = new Error(`INTAKE_NOT_AUTHORIZED: ${cutoff.reason}`);
    err.code = 'INTAKE_NOT_AUTHORIZED';
    err.cutoff = cutoff;
    throw err;
  }
  if (!adapters) {
    throw new Error('runIntake: no acquisition adapters supplied. Live production adapters are not implemented in this pass (intake is not authorized to run yet) -- only injected mock adapters are lawful here.');
  }

  // ── From here on, this is the real Step 1-8 pipeline, run against
  // whatever adapters were injected. In production this pass never
  // executes because the gate above always throws first (no VERIFIED
  // AD-3 status exists in this repo snapshot).
  const rawPool = adapters.collectRawPool({ lookbackDays: intake.LOOKBACK_DAYS, cutoffTimestamp: cutoff.cutoffTimestamp });
  const { pool: afterExact, merges } = intake.dedupExactId(rawPool);
  const { pool: afterEquiv } = intake.applyEquivalenceKeys(afterExact);
  const { pool: flaggedPool, flags } = intake.flagPossibleDuplicates(afterEquiv);

  const evaluated = flaggedPool.map((item) => ({ item, elig: intake.checkEligibility(item, { cutoffTimestamp: cutoff.cutoffTimestamp, aiLintPass: adapters.aiLintPass ? adapters.aiLintPass(item) : true }) }));
  const eligible = evaluated.filter((e) => e.elig.eligible).map((e) => ({ ...e.item, daysToResolution: e.elig.daysToResolution }));
  const rejected = evaluated.filter((e) => !e.elig.eligible).map((e) => ({ item: e.item, reason: e.elig.reason }));

  const byBucket = { short: [], medium: [], long: [] };
  for (const item of eligible) byBucket[intake.horizonBucket(item.daysToResolution)].push(item);

  const selectedByBucket = {}, skippedByBucket = {}, orderedByBucket = {};
  for (const bucket of ['short', 'medium', 'long']) {
    const ordered = intake.orderItems(byBucket[bucket], cutoff.cutoffTimestamp);
    orderedByBucket[bucket] = ordered;
    const { selected, skipped } = intake.selectWithDuplicateSkip(ordered, 5);
    selectedByBucket[bucket] = selected;
    skippedByBucket[bucket] = skipped;
  }

  const withQuota = intake.applyDifficultyQuota(selectedByBucket, orderedByBucket, adapters.adversaryFlag);

  const result = {
    cutoff, rawPoolSize: rawPool.length, merges, possibleDuplicateFlags: flags,
    rejected, selectedByBucket: withQuota.selectedByBucket, skippedByBucket,
    difficultyQuota: { substitutions: withQuota.substitutions, materialCount: withQuota.materialCount, targetCount: withQuota.targetCount, quotaMet: withQuota.quotaMet },
  };

  if (!dryRun) {
    throw new Error('runIntake: writing candidate-slate.json is not implemented in this pass -- this build stops at producing the in-memory selection result. Populating the repo file is a separate, later action explicitly excluded from this authorization.');
  }
  return result;
}

if (require.main === module) {
  // AUTHORIZATION GATE (intake-execution-001): after the frozen cutoff, real
  // execution additionally requires the supervised invocation mode (explicit
  // CLI flag + owner-set env marker — ordinary CI can never supply it) AND
  // every machine-verified precondition A–H. Without them the CLI only
  // reports the precondition state and exits 3 — it NEVER runs the pipeline.
  // Before the cutoff, the frozen gate inside runIntake still throws first
  // (exit 2), exactly as BUILD 04.1 CI proves.
  const authz = require('./lib/intake-authorization.js');
  try {
    const supervised = authz.supervisedModeRequested(process.argv, process.env);
    if (!supervised) {
      // Prove the frozen cutoff gate exactly as before; never proceed past it.
      const { computeCutoffFromRepo } = require('./lib/intake-cutoff.js');
      const cutoff = computeCutoffFromRepo(require('path').join(__dirname, '..'));
      if (!cutoff.authorized) {
        runIntake({}); // throws INTAKE_NOT_AUTHORIZED -> exit 2 (unchanged pre-cutoff behavior)
      }
      const pre = authz.evaluateFromRepo(require('path').join(__dirname, '..'), { supervisedMode: false });
      console.log('=== INTAKE NOT EXECUTED (unsupervised invocation) ===');
      for (const f of pre.failures) console.log('  - ' + f);
      console.log('Supervised execution requires: ' + authz.SUPERVISED_FLAG + ' AND ' + authz.SUPERVISED_ENV + '=' + authz.SUPERVISED_ENV_VALUE);
      process.exit(3);
    }
    // Supervised path: every precondition must hold, verified fresh, fail-closed.
    // Live readiness must be produced by THIS environment immediately before.
    const { spawnSync } = require('child_process');
    const ready = spawnSync(process.execPath, [require('path').join(__dirname, 'verify-acquisition-readiness.js')], { encoding: 'utf8', env: process.env });
    process.stdout.write(ready.stdout || '');
    const aggregate = /AGGREGATE INTAKE_READINESS: READY/.test(ready.stdout || '') ? 'READY' : 'BLOCKED';
    const pre = authz.evaluateFromRepo(require('path').join(__dirname, '..'), { supervisedMode: true, readinessAggregate: aggregate });
    if (!pre.allowed) {
      console.log('=== SUPERVISED EXECUTION REFUSED (fail-closed) ===');
      for (const f of pre.failures) console.log('  - ' + f);
      process.exit(3);
    }
    console.log('=== ALL EXECUTION PRECONDITIONS VERIFIED — proceeding under intake-execution-001 ===');
    runIntake({ dryRun: false });
    console.log('INTAKE RAN.');
  } catch (e) {
    console.log(`=== INTAKE REFUSED ===\n${e.message}`);
    process.exit(e.code === 'INTAKE_NOT_AUTHORIZED' ? 2 : 1);
  }
}

module.exports = { runIntake };
