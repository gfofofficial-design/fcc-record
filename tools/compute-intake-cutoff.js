#!/usr/bin/env node
// Reports BOTH cutoff lineages explicitly — no silent "highest filename wins".
// EPOCH 1 (v0.2) is CLOSED and shown for historical reconstruction only;
// EPOCH 2 (v0.3) is the live lineage. Never runs intake. Read-only.
const path = require('path');
const { computeCutoffFromRepo, computeEpoch2CutoffFromRepo } = require('./lib/intake-cutoff.js');

const ROOT = path.join(__dirname, '..');
console.log('=== FCC STAGE 0 — INTAKE CUTOFF STATUS ===');
console.log('--- EPOCH 1 / v0.2 lineage (CLOSED: STRUCTURAL_METHODOLOGY_INFEASIBILITY; historical reconstruction only; NOT an Epoch 2 input) ---');
console.log(JSON.stringify(computeCutoffFromRepo(ROOT), null, 2));
const e2 = computeEpoch2CutoffFromRepo(ROOT);
console.log('--- EPOCH 2 / v0.3 lineage (EPOCH2_CUTOFF_RULE_CANONICAL_V03) ---');
console.log(JSON.stringify(e2, null, 2));
console.log('');
console.log('EPOCH 2 INTAKE: NOT AUTHORIZED (cutoff computability/arrival never authorizes intake; separate v2 gates required)');
process.exit(0);
