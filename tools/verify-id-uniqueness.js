#!/usr/bin/env node
// Foundation check: scans record/ for any duplicate human-facing IDs across
// instrument/filing/correction/proposal namespaces. Empty record = trivially passes;
// the check exists and is exercised against fixtures in tests/.
const fs = require('fs'), path = require('path');
function scanIds(dir, regex) {
  const ids = [];
  if (!fs.existsSync(dir)) return ids;
  const walk = (d) => fs.readdirSync(d, {withFileTypes:true}).forEach(e => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else { const m = fs.readFileSync(p,'utf8').match(regex); if (m) ids.push(...m); }
  });
  walk(dir);
  return ids;
}
const ids = scanIds('record', /FCC-[IFCP]-\d{6}/g);
const dupes = ids.filter((id,i) => ids.indexOf(id) !== i);
if (dupes.length) { console.error('DUPLICATE IDS:', [...new Set(dupes)]); process.exit(1); }
console.log(`ID uniqueness check passed (${ids.length} ids scanned, 0 duplicates).`);
