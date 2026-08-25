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
  try {
    runIntake({});
    console.log('INTAKE RAN (unexpected in this repo snapshot).');
  } catch (e) {
    console.log(`=== INTAKE REFUSED ===\n${e.message}`);
    process.exit(e.code === 'INTAKE_NOT_AUTHORIZED' ? 2 : 1);
  }
}

module.exports = { runIntake };
