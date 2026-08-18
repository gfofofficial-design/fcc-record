// BUILD 02.1 item 4 — Δ-expiry procedure, pure state/procedure logic only.
// No real witnesses. LOCK_PUBLICATION_TOLERANCE is the ratified R-Δ value:
// the NORMAL publication tolerance for a healthy Lock Run, not a
// reconciliation-hold timeout (reconciliation hold has no fixed maximum
// by design -- see CASE B).
//
// This module classifies a set of witness-submission attempts at
// Δ-expiry into CASE A (provably unpublished) or CASE B (uncertain), per
// the ratified corrected boundary: destruction is lawful ONLY when
// non-publication is independently/deterministically established;
// potentially-published bytes are always retained under reconciliation
// hold. PUBLICATION_RECONCILIATION_HOLD is an operational condition, not
// a Capital Instrument lifecycle state -- the frozen state machine
// (DRAFT -> FILED/LOCKED -> OPEN -> TERMINAL) is never touched by this
// module.
const LOCK_PUBLICATION_TOLERANCE_MS = 5 * 60 * 1000; // R-Δ = 5 minutes, ratified

// Each attempt: { witness: string, crossedExternalBoundary: bool,
//                 outcome: 'PENDING' | 'CONFIRMED_FAILED' | 'CONFIRMED_PUBLISHED' }
function classifyAttempts(attempts) {
  if (attempts.length === 0) return 'CASE_A'; // no submission ever crossed a boundary
  const anyPublished = attempts.some(a => a.outcome === 'CONFIRMED_PUBLISHED');
  if (anyPublished) return 'ALREADY_PUBLISHED'; // commit point reached; not an expiry case at all
  const anyUncertain = attempts.some(a => a.crossedExternalBoundary && a.outcome === 'PENDING');
  return anyUncertain ? 'CASE_B' : 'CASE_A'; // every crossed-boundary attempt authoritatively failed => A
}

// state: { filedAt: ISOString, generatedBytesRef: any, lockHashRef: string,
//          instrumentId: string, attempts: Attempt[] }
// nowMs: current time in ms (injectable for deterministic testing)
// Returns a new procedure-state object; never mutates input.
function evaluateExpiry(state, nowMs) {
  const filedAtMs = new Date(state.filedAt).getTime();
  const elapsed = nowMs - filedAtMs;
  if (elapsed < LOCK_PUBLICATION_TOLERANCE_MS) {
    return { ...state, phase: 'WITHIN_TOLERANCE', holdActive: false, bytesDiscarded: false };
  }
  const cls = classifyAttempts(state.attempts);
  if (cls === 'ALREADY_PUBLISHED') {
    // Correction 1 supreme: first witness success already occurred. Not an
    // expiry case; the commit point stands regardless of Δ.
    return { ...state, phase: 'COMMIT_POINT_REACHED', holdActive: false, bytesDiscarded: false };
  }
  if (cls === 'CASE_A') {
    return {
      ...state, phase: 'EXPIRED_CASE_A', holdActive: false, bytesDiscarded: true,
      instrumentRemainsDraft: true, freshRunPermitted: true,
      generatedBytesRef: null, lockHashRef: null,
    };
  }
  // CASE_B
  return {
    ...state, phase: 'PUBLICATION_RECONCILIATION_HOLD', holdActive: true, bytesDiscarded: false,
    secondHashProhibitedForId: state.instrumentId,
    // generatedBytesRef / lockHashRef explicitly RETAINED, unchanged
  };
}

// Re-evaluate a held state once new attempt outcomes are known. Returns
// the same shape as evaluateExpiry's Case A/B results, or a RESOLVED_
// outcome if a delayed publication surfaced.
function reconcileHold(heldState, updatedAttempts) {
  const cls = classifyAttempts(updatedAttempts);
  if (cls === 'ALREADY_PUBLISHED') {
    return { ...heldState, attempts: updatedAttempts, phase: 'RESOLVED_COMMIT_POINT', holdActive: false, bytesDiscarded: false };
  }
  if (cls === 'CASE_A') {
    // every previously-uncertain attempt now proven non-published/failed
    return {
      ...heldState, attempts: updatedAttempts, phase: 'RESOLVED_RELEASED_CASE_A', holdActive: false,
      bytesDiscarded: true, instrumentRemainsDraft: true, freshRunPermitted: true,
      generatedBytesRef: null, lockHashRef: null,
    };
  }
  // still uncertain — hold continues indefinitely by design (no max duration)
  return { ...heldState, attempts: updatedAttempts, phase: 'PUBLICATION_RECONCILIATION_HOLD', holdActive: true, bytesDiscarded: false };
}

// Guard used by a Lock Run initiator: throws if the target instrument id
// currently has an active PUBLICATION_RECONCILIATION_HOLD. This is the
// mechanical enforcement of "prohibit generation of another hash for that
// instrument ID" while a hold is active.
function assertSecondHashAllowed(heldStatesById, instrumentId) {
  const held = heldStatesById[instrumentId];
  if (held && held.holdActive) {
    throw new Error(`SECOND HASH REJECTED: instrument ${instrumentId} is under PUBLICATION_RECONCILIATION_HOLD — an earlier Lock Run's bytes may still become publicly FILED/LOCKED. No new hash may be generated for this id while the hold is active.`);
  }
}

module.exports = { LOCK_PUBLICATION_TOLERANCE_MS, classifyAttempts, evaluateExpiry, reconcileHold, assertSecondHashAllowed };
