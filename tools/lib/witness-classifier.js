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
// TELEGRAM (AD-3 VERIFIED — governance/gates/build03-1-ad3-status.v2.json):
// SUCCESS = send acknowledgement + independent public observability. The
// real Federation-channel readback semantics were empirically verified by
// the owner-run harness (2026-08); production-mode classification is lawful
// ONLY when the VERIFIED AD-3 governance record is explicitly injected as
// the third argument. MOCK mode is unchanged. Classification rules are
// identical in both modes — production activation relaxes nothing.
// Absence-after-API-success NEVER downgrades to failure (deletion is
// possible on Telegram — empirically confirmed) — it stays UNCERTAIN,
// permanently if need be. Timeout behavior was deliberately not
// manufactured against the live service; Case-B treatment retained.

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

function classifyTelegramAttempt({ send, publicReadback, instrumentId, lockSha256 }, mode, ad3GateRecord) {
  // AD-3 CLOSURE (2026-08-29): production-mode classification is lawful ONLY when
  // the caller explicitly injects the VERIFIED AD-3 governance record (resolved via
  // the gate lineage, e.g. intake-cutoff.js readAd3Status). Empirical basis: the
  // owner-run harness against the real @FCC_Com_Bot / @FCC_Command pair verified
  // send acknowledgement, independent unauthenticated public readback (exact
  // content, repeated across sessions), edit reflected publicly, delete removing
  // public visibility, and the authoritative 'chat not found' rejection class.
  // Timeout behavior was deliberately NOT manufactured against the live service,
  // so ambiguous/timeout outcomes keep the conservative Case-B treatment below —
  // this function's classification rules are byte-for-byte the AD-3-ratified
  // standard and are NOT relaxed by production activation.
  const productionActivated = !!(ad3GateRecord
    && ad3GateRecord.decision === 'AD-3'
    && ad3GateRecord.status === 'VERIFIED'
    && ad3GateRecord.verified_at);
  if (mode !== 'MOCK' && !(mode === 'PRODUCTION' && productionActivated)) {
    throw new Error('TELEGRAM_PRODUCTION_CLASSIFIER_GATED: AD-3 — the production Telegram success classifier activates only with the VERIFIED AD-3 governance record explicitly supplied. Without it, only mode="MOCK" is lawful.');
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
