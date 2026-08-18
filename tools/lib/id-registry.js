// TEST-ONLY, NON-AUTHORITATIVE instrument-id generator (BUILD 02.1 item 5).
//
// WITHDRAWN AS AN AUTHORITY. This module previously claimed to reserve
// production FCC-I-* ids in a local gitignored file -- that claim is
// withdrawn: a local ignored file cannot guarantee "never reused" across
// workspace loss, machines, clones, or operators (per the ratified
// architecture adjudication).
//
// Authoritative FCC-I-* assignment belongs in the public Doctrine SF3
// Filing Log, created when an assessment's work begins. That workflow
// does NOT exist yet -- it is explicitly out of BUILD 02's scope. Until
// it is built, there is no authoritative id source, and production code
// MUST refuse to mint one (see tools/lock-run.js, which requires an
// externally-supplied authoritativeInstrumentId and never calls this
// module).
//
// This module exists solely so isolated test fixtures (in throwaway
// clones, never touching real record/) can generate syntactically valid,
// locally-unique ids without duplicating format logic.
function formatTestId(n) {
  if (n < 1 || n > 999999) throw new Error('instrument id sequence out of six-digit range');
  return 'FCC-I-' + String(n).padStart(6, '0');
}
let _testCounter = 0;
function nextNonAuthoritativeTestId() {
  _testCounter += 1;
  return formatTestId(_testCounter);
}
module.exports = { formatTestId, nextNonAuthoritativeTestId };
