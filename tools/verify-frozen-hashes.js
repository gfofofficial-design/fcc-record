#!/usr/bin/env node
// Re-verifies the three controlling frozen documents on every CI run.
const fs = require('fs'), crypto = require('crypto');
const EXPECTED = {
  'governance/frozen/FCC_PRODUCT_BLUEPRINT_V1_1_1.md': 'e82b16fa5c09c26ca935a67bc5be9e43f36d83372fac895f5a87d7a37ebea77f',
  'governance/frozen/FCC_CAPITAL_DOCTRINE_V0_1_1.md': '65decceac559749e060c9e895ddfa1719a4bdbd04dea6a0924f15135e779f45e',
  'governance/frozen/FCC_CAPITAL_INSTRUMENT_SPEC_V0_1_1.md': 'ac16c70fae1571d890d7dff9218c73cc3f6673892be9491d1d250c82d032beb0',
};
let fail = false;
for (const [f, exp] of Object.entries(EXPECTED)) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const ok = actual === exp;
  console.log((ok?'PASS ':'FAIL ') + f + ' ' + actual.slice(0,16) + '…');
  if (!ok) fail = true;
}
if (fail) { console.error('FROZEN DOCUMENT HASH MISMATCH — CI FAILS'); process.exit(1); }
console.log('All frozen governing documents verified.');
