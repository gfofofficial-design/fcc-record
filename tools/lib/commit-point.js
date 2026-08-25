// BUILD 03 — COMMIT-POINT DETERMINATION (pure).
//
// Frozen law (Correction 1): DRAFT -> FILED/LOCKED occurs at the FIRST
// successful independently observable publication of the final lock_sha256
// through an approved witness, irrevocably. The witnesses are not atomic;
// the commit point is a DETERMINATION OVER EVIDENCE, not a transaction.
//
// Input: attempts = [{witness, classification}] where classification is a
// witness-classifier result. Output: null (no success yet) or
// {witness, attestedTime, timeEvidenceClass, publicationRef, allSuccessRefs,
//  interWitnessAmbiguity}.
//
// Ordering between two successful witnesses uses each host's own attested
// timestamp, recorded verbatim, attestation-grade. If either successful
// attempt lacks a comparable time, or times are equal, BOTH are preserved
// and the determination notes the ambiguity — the lock's existence never
// depends on resolving it (either way, FILED/LOCKED occurred).
function determineCommitPoint(attempts) {
  const successes = attempts
    .map((a, i) => ({ ...a, _index: i }))
    .filter((a) => a.classification && a.classification.outcome === 'SUCCESS');
  if (successes.length === 0) return null;
  const withTime = successes.filter((s) => s.classification.attestedTime);
  let winner, ambiguity = null;
  if (withTime.length === successes.length && successes.length > 1) {
    const sorted = [...successes].sort((x, y) => new Date(x.classification.attestedTime) - new Date(y.classification.attestedTime));
    winner = sorted[0];
    if (sorted.length > 1 && +new Date(sorted[0].classification.attestedTime) === +new Date(sorted[1].classification.attestedTime)) {
      ambiguity = 'equal host-attested times across witnesses; earlier-by-attestation undecidable; both preserved';
      winner = sorted.find((s) => s.witness === 'git') || sorted[0]; // deterministic tiebreak for recording only; both refs retained
    }
  } else if (successes.length > 1 && withTime.length < successes.length) {
    ambiguity = 'a successful witness lacks a host-attested time; earlier-by-attestation undecidable; both preserved';
    winner = withTime[0] || successes[0];
  } else {
    winner = successes[0];
  }
  return {
    witness: winner.witness,
    attestedTime: winner.classification.attestedTime || null,
    timeEvidenceClass: winner.classification.timeEvidenceClass || null,
    publicationRef: winner.classification.publicationRef || null,
    allSuccessRefs: successes.map((s) => s.classification.publicationRef).filter(Boolean),
    interWitnessAmbiguity: ambiguity,
  };
}
module.exports = { determineCommitPoint };
