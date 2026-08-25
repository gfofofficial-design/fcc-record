#!/usr/bin/env node
// BUILD 04.1 — reports whether candidate intake is currently authorized.
// Never runs intake itself. Read-only against real repo governance records.
const path = require('path');
const { computeCutoffFromRepo } = require('./lib/intake-cutoff.js');

const ROOT = path.join(__dirname, '..');
const result = computeCutoffFromRepo(ROOT);

console.log('=== FCC STAGE 0 — INTAKE CUTOFF STATUS ===');
console.log(JSON.stringify(result, null, 2));
console.log('');
console.log(result.authorized ? 'INTAKE: AUTHORIZED' : 'INTAKE: NOT AUTHORIZED');
process.exit(0);
