#!/usr/bin/env node
// BUILD 01.2 item 3: wires the append-only law to the ACTUAL proposed
// commit range in GitHub Actions, not just synthetic test branches.
//
// PR event   : base = pull_request base SHA, head = HEAD
// push event : base = the pre-push commit (`before`), head = the new HEAD (`after`)
// Genesis push (no prior history — `before` is the all-zero SHA GitHub
// sends for a brand-new branch) is explicitly allowed without a diff:
// there is nothing to compare against, so nothing can violate append-only
// law on that push by definition.
const { checkAppendOnlyLaw } = require('./lib/append-only-law.js');

const ZERO_SHA = '0'.repeat(40);
const eventName = process.env.GITHUB_EVENT_NAME;
const base = process.env.CI_APPEND_ONLY_BASE;
const head = process.env.CI_APPEND_ONLY_HEAD || 'HEAD';

if (!base) {
  console.error('CI_APPEND_ONLY_BASE not set — cannot determine comparison range.');
  process.exit(1);
}

if (base === ZERO_SHA) {
  console.log(`Genesis ${eventName || 'push'} detected (base is the all-zero SHA) — no prior history to compare against. Append-only check trivially satisfied.`);
  process.exit(0);
}

const violations = checkAppendOnlyLaw(base, head);
if (violations.length) {
  console.error(`APPEND-ONLY LAW VIOLATION(S) in range ${base}..${head}:\n` + violations.map(v => '  ' + v).join('\n'));
  process.exit(1);
}
console.log(`Append-only law satisfied for the actual proposed range ${base}..${head}.`);
