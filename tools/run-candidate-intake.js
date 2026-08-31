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

// ── reviewable, deterministic, credential-free summary of an in-memory result ──
function summarizeIntake(result, provider) {
  const bySource = (arr) => arr.reduce((m, x) => { const k = (x.item || x).sourceId; m[k] = (m[k] || 0) + 1; return m; }, {});
  const sel = Object.entries(result.selectedByBucket).flatMap(([b, items]) => items.map((i) => ({ bucket: b, sourceId: i.sourceId, canonicalId: i.canonicalId, title: i.title || null, resolutionDate: i.resolutionDate, openedAt: i.openedAt })));
  const rejectedReasons = result.rejected.reduce((m, r) => { m[r.reason] = (m[r.reason] || 0) + 1; return m; }, {});
  const bucketCounts = Object.fromEntries(Object.entries(result.selectedByBucket).map(([b, i]) => [b, i.length]));
  const shortage = {};
  for (const b of ['short', 'medium', 'long']) shortage[b] = intake.shortageAction(b, (result.selectedByBucket[b] || []).length, 5, intake.LOOKBACK_DAYS);
  return {
    classification: 'IN_MEMORY_INTAKE_RESULT — NOTHING WRITTEN',
    cutoff: result.cutoff.cutoffTimestamp,
    providerKind: provider.kind,
    sourceAcquisition: provider.stats,
    rawPoolSize: result.rawPoolSize,
    exactIdMerges: result.merges.length,
    possibleDuplicateFlags: result.possibleDuplicateFlags.length,
    rejectedByReason: rejectedReasons,
    eligibleBySource: bySource(Object.values(result.selectedByBucket).flat().concat(Object.values(result.skippedByBucket).flat())),
    bucketCounts, shortage,
    difficultyQuota: result.difficultyQuota,
    benchmarks: { G1_Polymarket: 'BENCHMARK_ONLY — not queried at intake; never candidate-generating', G2_Kalshi: 'BENCHMARK_ONLY — not queried at intake; never candidate-generating' },
    selected: sel.sort((a, b) => (a.bucket + a.sourceId + a.canonicalId).localeCompare(b.bucket + b.sourceId + b.canonicalId)),
    disclosures: provider.disclosures,
  };
}

if (require.main === module) {
  // AUTHORIZATION GATE (intake-execution-001) + SUPERVISED EXECUTION WIRING.
  // Flow, in order and fail-closed: supervised mode -> live readiness in THIS
  // process/environment (never a stale artifact) -> preconditions A–H -> build
  // the live provider -> collect -> in-memory pipeline. With --no-write-dry-run
  // the reviewable summary is printed and NOTHING is written. Without it, the
  // final write path is invoked, which currently REFUSES pending the recorded
  // append-only architecture decision (tools/lib/intake-final-write.js).
  // Before the cutoff the frozen gate inside runIntake still throws first (exit 2).
  const authz = require('./lib/intake-authorization.js');
  const NO_WRITE = process.argv.includes('--no-write-dry-run');
  (async () => {
    try {
      const supervised = authz.supervisedModeRequested(process.argv, process.env);
      if (!supervised) {
        const { computeCutoffFromRepo } = require('./lib/intake-cutoff.js');
        const cutoff = computeCutoffFromRepo(ROOT);
        if (!cutoff.authorized) runIntake({}); // throws INTAKE_NOT_AUTHORIZED -> exit 2 (unchanged pre-cutoff behavior)
        const pre = authz.evaluateFromRepo(ROOT, { supervisedMode: false });
        console.log('=== INTAKE NOT EXECUTED (unsupervised invocation) ===');
        for (const f of pre.failures) console.log('  - ' + f);
        console.log('Supervised execution requires: ' + authz.SUPERVISED_FLAG + ' AND ' + authz.SUPERVISED_ENV + '=' + authz.SUPERVISED_ENV_VALUE);
        process.exit(3);
      }
      const { spawnSync } = require('child_process');
      const ready = spawnSync(process.execPath, [path.join(__dirname, 'verify-acquisition-readiness.js')], { encoding: 'utf8', env: process.env });
      process.stdout.write(ready.stdout || '');
      const aggregate = /AGGREGATE INTAKE_READINESS: READY/.test(ready.stdout || '') ? 'READY' : 'BLOCKED';
      const pre = authz.evaluateFromRepo(ROOT, { supervisedMode: true, readinessAggregate: aggregate });
      if (!pre.allowed) {
        console.log('=== SUPERVISED EXECUTION REFUSED (fail-closed) ===');
        for (const f of pre.failures) console.log('  - ' + f);
        process.exit(3);
      }
      console.log('=== ALL EXECUTION PRECONDITIONS VERIFIED — proceeding under ' + pre.authorization.authorization_id + (NO_WRITE ? ' [LIVE NO-WRITE DRY-RUN]' : '') + ' ===');
      const { buildLiveProvider } = require('./lib/live-acquisition-provider.js');
      const provider = buildLiveProvider({ repoRoot: ROOT, env: process.env });
      await provider.collect();
      const result = runIntake({ adapters: provider, dryRun: true }); // in-memory only, always
      const summary = summarizeIntake(result, provider);
      console.log('=== INTAKE RESULT SUMMARY (in memory) ===');
      console.log(JSON.stringify(summary, null, 2));
      if (NO_WRITE) { console.log('=== LIVE NO-WRITE DRY-RUN COMPLETE — candidate-slate.json untouched, no completion marker, authorization unspent ==='); process.exit(0); }
      require('./lib/intake-final-write.js').executeFinalWrite(); // fail-closed until the architecture decision is recorded
    } catch (e) {
      console.log(`=== INTAKE REFUSED ===\n${e.message}`);
      process.exit(e.code === 'INTAKE_NOT_AUTHORIZED' ? 2 : e.code === 'ARCHITECTURE_DECISION_REQUIRED' ? 4 : 1);
    }
  })();
}

module.exports = { runIntake, summarizeIntake };
