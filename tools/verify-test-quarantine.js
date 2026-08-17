#!/usr/bin/env node
// Rejects any FCC-TEST-* identifier found inside record/ — the test namespace
// must never enter the genuine public record.
const fs = require('fs'), path = require('path');
function walk(dir, out=[]) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const files = walk('record');
const offenders = files.filter(f => f.includes('FCC-TEST') || (fs.readFileSync(f,'utf8').includes('FCC-TEST')));
if (offenders.length) { console.error('TEST-NAMESPACE QUARANTINE VIOLATION:', offenders); process.exit(1); }
console.log(`Test-namespace quarantine check passed (${files.length} record files scanned, 0 FCC-TEST-* references).`);
