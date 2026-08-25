// BUILD 03 — WITNESS EVIDENCE CLASSIFIERS (pure functions).
//
// Vocabulary bridge: classifier outcomes map onto the proven Δ-expiry
// attempt vocabulary (tools/lib/lock-run-expiry.js):
//   SUCCESS               -> CONFIRMED_PUBLISHED
//   AUTHORITATIVE_FAILURE -> CONFIRMED_FAILED
//   UNCERTAIN             -> PENDING
//
// GIT (AD-4 RATIFIED): the ANONYMOUS readback of the public repository is
// the NORMATIVE independent-observability check. The authenticated readback
// supplies host metadata (attested time). A local git commit is never
// publication; no code path here can classify SUCCESS without the anonymous
// readback confirming the blob publicly with the exact lock_sha256.
// Branch protection (frozen: force-push and deletion disabled on main) is
// what makes confirmed-absence deterministic evidence for git.
//
// TELEGRAM (AD-3 RATIFIED FOR IMPLEMENTATION, PRODUCTION ACTIVATION GATED):
// SUCCESS = send acknowledgement + independent public observability. The
// classifier below implements that standard against MOCK transport evidence
// only. PRODUCTION MODE IS STRUCTURALLY GATED: classifyTelegramAttempt
// throws unless mode === 'MOCK', because the real Federation-channel
// readback semantics have not been verified and must not be guessed.
// Absence-after-API-success NEVER downgrades to failure (deletion is
// possible on Telegram) — it stays UNCERTAIN, permanently if need be.

const OUTCOME = { SUCCESS: 'SUCCESS', FAILURE: 'AUTHORITATIVE_FAILURE', UNCERTAIN: 'UNCERTAIN' };
const toJournalOutcome = (o) => (o === OUTCOME.SUCCESS ? 'CONFIRMED_PUBLISHED' : o === OUTCOME.FAILURE ? 'CONFIRMED_FAILED' : 'PENDING');

function classifyGitAttempt({ push, authReadback, anonReadback, lockSha256 }) {
  if (!push) throw new Error('classifyGitAttempt: push evidence required');
  // Never crossed the boundary: deterministic non-publication.
  if (push.boundaryCrossed === false) {
    return { outcome: OUTCOME.FAILURE, crossedExternalBoundary: false, reason: 'transport failed before the request crossed the external boundary' };
  }
  const anonConfirms = anonReadback && anonReadback.available && anonReadback.commitFound && anonReadback.blobSha256 === lockSha256;
  const authConfirms = authReadback && authReadback.available && authReadback.commitFound && authReadback.blobSha256 === lockSha256;
  if (anonConfirms) {
    // AD-4: anonymous readback is normative. Host metadata (attested time)
    // comes from the authenticated channel when available, else push result.
    const attestedTime = (authConfirms && authReadback.hostAttestedTime) || push.hostPushTime || null;
    if (!attestedTime) {
      // Publicly observable but no host-attested time yet: publication is
      // real (commit point can stand on it) — time evidence recorded as the
      // readback observation. Never invent a host time.
      return { outcome: OUTCOME.SUCCESS, crossedExternalBoundary: true, attestedTime: anonReadback.observedAt || null, timeEvidenceClass: 'READBACK_OBSERVATION', reason: 'anonymous public readback confirms exact bytes; host time pending', publicationRef: refFromGit(push, authReadback) };
    }
    return { outcome: OUTCOME.SUCCESS, crossedExternalBoundary: true, attestedTime, timeEvidenceClass: 'HOST_ATTESTED', reason: 'push accepted + authenticated readback + NORMATIVE anonymous readback all confirm exact bytes', publicationRef: refFromGit(push, authReadback) };
  }
  // Definitive rejection + confirmed public absence = deterministic failure.
  const anonConfirmsAbsence = anonReadback && anonReadback.available && anonReadback.commitFound === false;
  if (push.definitiveRejection && anonConfirmsAbsence) {
    return { outcome: OUTCOME.FAILURE, crossedExternalBoundary: true, reason: 'remote definitively rejected the push and anonymous readback confirms public absence (branch protection makes absence deterministic)' };
  }
  // Everything else — timeout, ambiguous error, readback unavailable,
  // rejection without a completed absence check — is UNCERTAIN.
  return { outcome: OUTCOME.UNCERTAIN, crossedExternalBoundary: true, reason: 'boundary crossed; publication neither confirmed present nor deterministically absent' };
}
function refFromGit(push, authReadback) {
  return { witness: 'git', commitSha: (authReadback && authReadback.commitSha) || push.commitSha || null, path: null };
}

function classifyTelegramAttempt({ send, publicReadback, instrumentId, lockSha256 }, mode) {
  if (mode !== 'MOCK') {
    throw new Error('TELEGRAM_PRODUCTION_CLASSIFIER_GATED: AD-3 — the production Telegram success classifier is not activated. Real Federation-channel verification is a later explicit gate. Only mode="MOCK" is lawful in BUILD 03.');
  }
  if (!send) throw new Error('classifyTelegramAttempt: send evidence required');
  if (send.boundaryCrossed === false) {
    return { outcome: OUTCOME.FAILURE, crossedExternalBoundary: false, reason: 'transport failed before the request crossed the external boundary' };
  }
  // Definitive pre-publication API error with no message created.
  if (send.definitiveError4xx && !send.messageId) {
    return { outcome: OUTCOME.FAILURE, crossedExternalBoundary: true, reason: 'definitive API rejection; no message was created' };
  }
  const observed = publicReadback && publicReadback.available && publicReadback.found;
  if (send.ok && observed) {
    return {
      outcome: OUTCOME.SUCCESS, crossedExternalBoundary: true,
      attestedTime: send.hostDate || null, timeEvidenceClass: 'HOST_ATTESTED',
      reason: 'send acknowledged + independent public readback observed the message',
      publicationRef: { witness: 'telegram', messageId: send.messageId, hostDate: send.hostDate || null, readbackContentSha256: publicReadback.contentSha256 || null, observedAt: publicReadback.observedAt || null },
    };
  }
  // API success but readback absent/unavailable: NEVER a failure (deletion
  // and rendering behavior make absence non-deterministic for Telegram).
  // Timeouts, 5xx, network drops after send: same class.
  return { outcome: OUTCOME.UNCERTAIN, crossedExternalBoundary: true, reason: send.ok ? 'send acknowledged but independent public observability not confirmed — possibly published (absence is not deterministic for Telegram)' : 'send result ambiguous after boundary crossing — possibly published' };
}

module.exports = { OUTCOME, toJournalOutcome, classifyGitAttempt, classifyTelegramAttempt };
