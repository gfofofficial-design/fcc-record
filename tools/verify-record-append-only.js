#!/usr/bin/env node
// CI/CLI entrypoint for the append-only law (tools/lib/append-only-law.js).
// Standalone usage: node tools/verify-record-append-only.js <baseRef> <headRef>
const { checkAppendOnlyLaw } = require('./lib/append-only-law.js');
if (require.main === module) {
  const [,, base, head] = process.argv;
  const v = checkAppendOnlyLaw(base, head);
  if (v.length) { console.error('APPEND-ONLY LAW VIOLATION(S):\n' + v.map(x => '  ' + x).join('\n')); process.exit(1); }
  console.log(`Append-only law satisfied for range ${base}..${head}`);
}
module.exports = { checkAppendOnlyLaw };
