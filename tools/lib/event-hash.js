// Event hash foundation (BUILD 02 item 7), per frozen architecture v0.1.2
// Correction 2: event_sha256 = SHA256(RFC8785(event object excluding
// event_sha256)), with prev_event_sha256 INSIDE the canonicalized object.
const crypto = require('crypto');
const { dualCanonicalize } = require('./canonicalize.js');

const ZERO_ROOT = '0'.repeat(64);

// eventWithoutHash must already contain prev_event_sha256. Returns the hex
// event_sha256. Hard-fails (via dualCanonicalize) on any Node/Python
// canonicalization mismatch — no event hash may be produced when parity fails.
function computeEventHash(eventWithoutHash) {
  if ('event_sha256' in eventWithoutHash) throw new Error('event object must not already contain event_sha256');
  if (!('prev_event_sha256' in eventWithoutHash)) throw new Error('event object missing prev_event_sha256');
  const { bytes } = dualCanonicalize(eventWithoutHash);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// Builds a complete, hashed event from a partial event + explicit prev hash.
function buildEvent(partial, prevEventSha256) {
  const withoutHash = { ...partial, prev_event_sha256: prevEventSha256 };
  const event_sha256 = computeEventHash(withoutHash);
  return { ...withoutHash, event_sha256 };
}

// Verifies a full chain of events (array, in order). rootExpected is either
// a lock_sha256 (instrument chains) or 64 zeroes (repo-level logs).
// Returns { ok: true } or { ok: false, brokenAtIndex, reason }.
function verifyEventChain(events, rootExpected) {
  let expectedPrev = rootExpected;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.prev_event_sha256 !== expectedPrev) {
      return { ok: false, brokenAtIndex: i, reason: `prev_event_sha256 mismatch: expected ${expectedPrev}, got ${e.prev_event_sha256}` };
    }
    const { event_sha256, ...rest } = e;
    let recomputed;
    try { recomputed = computeEventHash(rest); }
    catch (err) { return { ok: false, brokenAtIndex: i, reason: 'canonicalization/hash error: ' + err.message }; }
    if (recomputed !== event_sha256) {
      return { ok: false, brokenAtIndex: i, reason: `event_sha256 mismatch: recomputed ${recomputed}, stored ${event_sha256}` };
    }
    expectedPrev = event_sha256;
  }
  return { ok: true };
}

module.exports = { computeEventHash, buildEvent, verifyEventChain, ZERO_ROOT };
