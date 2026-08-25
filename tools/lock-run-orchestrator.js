#!/usr/bin/env node
// BUILD 03 — LOCK RUN ORCHESTRATOR (P1–P12) + CRASH/STARTUP RECOVERY.
//
// This is the PRODUCTION ENTRY POINT shape for witness orchestration, wired
// end-to-end against transport abstractions. In BUILD 03 only MOCK
// transports are constructible (witness-transports.js throws on production
// constructors) and the Telegram production classifier is gated (AD-3), so
// this code cannot publish anything real — structurally, not by policy.
//
// LAW WIRED HERE:
// - P4 IS UNAVOIDABLE (BUILD03_INVARIANT): assertSecondHashAllowed runs
//   against the PERSISTENT journal-derived hold state before any code path
//   that can canonicalize. There is no entry point that skips it:
//   prepareLockRun is only reachable through gateP4's return.
// - AD-1 STRENGTHENING: before permitting a hash for an id, BOTH approved
//   witnesses are probed for prior publication. Journal absence is NEVER
//   evidence of cleanliness. Probe unavailable/inconclusive => FAIL CLOSED.
// - Correction 1: commit point = first classified SUCCESS; irrevocable;
//   Δ-expiry (R-Δ = 5 min, ratified) governs no-success runs via the proven
//   lock-run-expiry module; Case B holds preserve bytes, prohibit 2nd hash.
// - Exact-byte retry: every retry reads bytes from the durable journal;
//   no code path from any failure back to canonicalization.
// - Git catch-up (frozen case 3): Telegram-first lock admits/pushes later,
//   carrying the witness publication_ref; bytes byte-identical.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { prepareLockRun } = require('./lock-run.js');
const journal = require('./lib/lock-run-journal.js');
const { classifyGitAttempt, classifyTelegramAttempt, toJournalOutcome } = require('./lib/witness-classifier.js');
const { determineCommitPoint } = require('./lib/commit-point.js');
const { buildWitnessMessage } = require('./lib/witness-transports.js');
const { appendInstrumentEvent, compactWitnessReceipt, serializeNdjson } = require('./lib/instrument-events.js');
const { LOCK_PUBLICATION_TOLERANCE_MS, evaluateExpiry, reconcileHold, assertSecondHashAllowed } = require('./lib/lock-run-expiry.js');
const { writePendingProof, classifyAnchorAttempt } = require('./lib/ots-wrapper.js');
const { verifyInstrumentIdAuthority } = require('./filing-log.js');

// ── P4 — THE UNAVOIDABLE GATE ───────────────────────────────────────────
// (a) persistent-hold guard (proven assertSecondHashAllowed, now against
//     the authoritative persistent store);
// (b) open-run refusal (an in-flight/un-admitted run is never a license);
// (c) AD-1 strengthened dual-witness prior-publication probe, fail-closed.
function gateP4({ stagingRoot, instrumentId, transports, telegramMode }) {
  const holds = journal.activeHoldStates(stagingRoot);
  assertSecondHashAllowed(holds, instrumentId); // throws on active hold (Fixture J/M lineage)
  const open = journal.openRunStates(stagingRoot);
  if (open[instrumentId]) {
    throw new Error(`SECOND_HASH_REFUSED: an open Lock Run (phase=${open[instrumentId].phase}) exists for ${instrumentId}. Recovery must resolve it first; a second hash is prohibited.`);
  }
  const prior = journal.loadRun(stagingRoot, instrumentId);
  if (prior && !['EXPIRED_CASE_A', 'RESOLVED_RELEASED_CASE_A'].includes(prior.phase)) {
    throw new Error(`SECOND_HASH_REFUSED: journal for ${instrumentId} is in phase ${prior.phase}; only a resolved CASE A permits a fresh run.`);
  }
  // AD-1 STRENGTHENING — witness-evidence probe, both witnesses, fail closed.
  const gitProbe = transports.git.anonReadback({ instrumentId });
  if (!gitProbe || gitProbe.available !== true) {
    throw new Error('PRIOR_PUBLICATION_STATUS_UNESTABLISHED: anonymous Git readback unavailable — cannot establish that no prior publication exists for this id. FAIL CLOSED (AD-1 strengthening): never generate a hash merely because local state is absent.');
  }
  if (gitProbe.commitFound) {
    throw new Error(`PRIOR_PUBLICATION_EXISTS: public repository already contains record/instruments/${instrumentId}/ — a publication exists; earliest-wins law governs; a new hash is prohibited.`);
  }
  const tgProbe = transports.telegram.publicReadback({ instrumentId });
  if (!tgProbe || tgProbe.available !== true) {
    throw new Error('PRIOR_PUBLICATION_STATUS_UNESTABLISHED: Telegram public readback unavailable — cannot establish that no prior witness publication exists for this id. FAIL CLOSED (AD-1 strengthening).');
  }
  if (tgProbe.found) {
    throw new Error(`PRIOR_PUBLICATION_EXISTS: a prior FCC-WITNESS publication for ${instrumentId} is observable on the Telegram witness; earliest-wins law governs; a new hash is prohibited.`);
  }
  void telegramMode; // probe uses raw observability, not the gated success classifier
  return true;
}

// ── Witness attempts (journal-before-send, classify, journal-after) ─────
function attemptGitWitness({ stagingRoot, instrumentId, lockSha256, transports, nowIso }) {
  const idx = journal.recordAttemptStart(stagingRoot, instrumentId, { witness: 'git', sentAt: nowIso(), requestMeta: { path: `record/instruments/${instrumentId}/locked.json` } });
  let push;
  try { push = transports.git.push({ instrumentId }); }
  catch (e) { push = { boundaryCrossed: true, accepted: false, definitiveRejection: false, error: String(e) }; } // exception after invoking transport: conservative
  let authReadback = null, anonReadback = null;
  try { authReadback = transports.git.authReadback({ instrumentId }); } catch (_) { authReadback = { available: false }; }
  try { anonReadback = transports.git.anonReadback({ instrumentId }); } catch (_) { anonReadback = { available: false }; }
  const classification = classifyGitAttempt({ push, authReadback, anonReadback, lockSha256 });
  journal.recordAttemptResult(stagingRoot, instrumentId, idx, {
    crossedExternalBoundary: classification.crossedExternalBoundary,
    outcome: toJournalOutcome(classification.outcome),
    evidence: { push, authReadback, anonReadback, classification }, // raw captures: OPERATIONAL JOURNAL ONLY (AD-2)
  });
  return { index: idx, witness: 'git', sentAt: nowIso(), classification };
}
function attemptTelegramWitness({ stagingRoot, instrumentId, lockSha256, transports, telegramMode, nowIso }) {
  const text = buildWitnessMessage(instrumentId, lockSha256);
  const idx = journal.recordAttemptStart(stagingRoot, instrumentId, { witness: 'telegram', sentAt: nowIso(), requestMeta: { textSha256: crypto.createHash('sha256').update(text).digest('hex') } });
  let send;
  try { send = transports.telegram.sendMessage({ text }); }
  catch (e) { send = { boundaryCrossed: true, ok: false, definitiveError4xx: false, error: String(e) }; }
  let publicReadback = null;
  try { publicReadback = transports.telegram.publicReadback({ messageId: send.messageId, instrumentId, lockSha256 }); } catch (_) { publicReadback = { available: false }; }
  const classification = classifyTelegramAttempt({ send, publicReadback, instrumentId, lockSha256 }, telegramMode);
  journal.recordAttemptResult(stagingRoot, instrumentId, idx, {
    crossedExternalBoundary: classification.crossedExternalBoundary,
    outcome: toJournalOutcome(classification.outcome),
    evidence: { send, publicReadback, classification },
  });
  return { index: idx, witness: 'telegram', sentAt: nowIso(), classification };
}

// ── Admission (P10): permanent locked bytes + events, BEFORE OTS (ratified
// sequencing clarification). recordRoot is the record working tree (a
// throwaway dir in fixtures; the real repo only under a future gate).
function admitInstrument({ recordRoot, instrumentId, canonicalBytes, events }) {
  const dir = path.join(recordRoot, 'record', 'instruments', instrumentId);
  const lockedPath = path.join(dir, 'locked.json');
  if (fs.existsSync(lockedPath)) {
    const existing = fs.readFileSync(lockedPath);
    if (!existing.equals(canonicalBytes)) throw new Error('ADMISSION REFUSED: locked.json already exists with DIFFERENT bytes — earliest-wins integrity procedure required; overwrite is not a code path');
    // identical bytes: idempotent catch-up
  } else {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(lockedPath, canonicalBytes, { flag: 'wx' });
  }
  fs.writeFileSync(path.join(dir, 'events.ndjson'), serializeNdjson(events)); // full-chain rewrite is lawful ONLY because events are the in-memory authoritative chain being serialized at admission; post-admission appends must append
  return { dir, lockedPath };
}

// ── THE LOCK RUN (P1–P12) ───────────────────────────────────────────────
// opts: { stagingRoot, recordRoot, instrumentId, prelockSemanticBody,
//         filingLogEvents, transports:{git,telegram}, telegramMode,
//         ulidGen, nowIso?, nowMs?, otsStamp?  (scripted; production stamping prohibited),
//         _onCanonicalize? (test sentinel) }
function runLockRun(opts) {
  const nowIso = opts.nowIso || (() => new Date().toISOString());
  const nowMs = opts.nowMs || (() => Date.now());
  const { stagingRoot, recordRoot, instrumentId, transports } = opts;
  const telegramMode = opts.telegramMode || 'MOCK';

  // P1/P2 — exclusive run lock + preflight. (Credential preflight is a
  // production-transport concern; mock transports carry no credentials.
  // The exclusive lockfile is per-stagingRoot.)
  const lockfile = path.join(stagingRoot, 'lock-runs', '.pipeline-lock');
  fs.mkdirSync(path.dirname(lockfile), { recursive: true });
  let lockFd;
  try { lockFd = fs.openSync(lockfile, 'wx'); }
  catch (_) { throw new Error('PIPELINE_LOCK_HELD: another Lock Run holds the exclusive pipeline lock (frozen threat-14 single-operator model)'); }
  try {
    // P3 — Filing Log authority verification (proven fail-closed law).
    const authority = verifyInstrumentIdAuthority(instrumentId, opts.filingLogEvents);
    if (!authority.authoritative) throw new Error(`FILING_LOG_AUTHORITY_REFUSED: ${authority.reason}`);

    // P4 — UNAVOIDABLE persistent gate + AD-1 strengthened probes.
    gateP4({ stagingRoot, instrumentId, transports, telegramMode });

    // P5 — mint + dual-canonicalize + hash (the ratified LOCK RUN proper).
    if (opts._onCanonicalize) opts._onCanonicalize(); // test sentinel: proves P4 precedes P5
    const artifact = prepareLockRun({ prelockSemanticBody: opts.prelockSemanticBody, authoritativeInstrumentId: instrumentId });
    const { canonical_bytes: canonicalBytes, lock_sha256: lockSha256, filed_at: filedAt } = artifact;

    // P6 — durable persistence BEFORE any witness send.
    journal.initRun(stagingRoot, { instrumentId, filedAt, lockSha256, canonicalBytes });

    // P7 — witness submission, git first (shrinks the disclosed
    // witness-only pre-observation window), order-independent by design.
    const attempts = [];
    attempts.push(attemptGitWitness({ stagingRoot, instrumentId, lockSha256, transports, nowIso }));
    attempts.push(attemptTelegramWitness({ stagingRoot, instrumentId, lockSha256, transports, telegramMode, nowIso }));

    // P8 — commit-point determination over classified evidence.
    const cp = determineCommitPoint(attempts);
    if (cp) {
      journal.recordCommitPoint(stagingRoot, instrumentId, cp);
      return finishFromCommitPoint({ ...opts, nowIso, canonicalBytes, lockSha256, filedAt, attempts, commitPoint: cp });
    }

    // P9 — Δ evaluation (proven module; nowMs injectable).
    const st = journal.loadRun(stagingRoot, instrumentId);
    const expiry = evaluateExpiry({ filedAt: st.filedAt, generatedBytesRef: 'journal', lockHashRef: st.lockSha256, instrumentId, attempts: st.attempts }, nowMs());
    if (expiry.phase === 'WITHIN_TOLERANCE') {
      // No success yet, still inside Δ: run remains RUNNING; retries/readbacks
      // happen via recovery/retry entry points against the SAME bytes.
      return { status: 'RUNNING_WITHIN_TOLERANCE', instrumentId, lockSha256, filedAt };
    }
    if (expiry.phase === 'EXPIRED_CASE_A') {
      journal.destroyBytesCaseA(stagingRoot, instrumentId, 'EXPIRED_CASE_A');
      return { status: 'EXPIRED_CASE_A', instrumentId, instrumentRemainsDraft: true, freshRunPermitted: true };
    }
    // CASE B
    journal.setPhase(stagingRoot, instrumentId, 'PUBLICATION_RECONCILIATION_HOLD', { holdActive: true, secondHashProhibitedForId: instrumentId });
    return { status: 'PUBLICATION_RECONCILIATION_HOLD', instrumentId, lockSha256, bytesPreserved: true };
  } finally {
    fs.closeSync(lockFd); fs.rmSync(lockfile, { force: true });
  }
}

// ── Commit point -> events -> admission -> OTS (P10–P12) ────────────────
function finishFromCommitPoint(ctx) {
  const { stagingRoot, recordRoot, instrumentId, canonicalBytes, lockSha256, filedAt, attempts, commitPoint, ulidGen, nowIso } = ctx;
  // Event chain: filed-locked genesis (rooted at lock_sha256) -> published
  // (commit point + ALL compact witness receipts) -> witness-degraded for
  // any non-success witness (frozen degradation vocabulary).
  let events = [];
  events = appendInstrumentEvent(events, lockSha256, { event_id: ulidGen(), type: 'filed-locked', at: commitPoint.attestedTime || nowIso(), payload: { instrument_id: instrumentId, filed_at: filedAt, lock_sha256: lockSha256 } });
  events = appendInstrumentEvent(events, lockSha256, {
    event_id: ulidGen(), type: 'published', at: commitPoint.attestedTime || nowIso(),
    payload: {
      commit_point: { witness: commitPoint.witness, attested_time: commitPoint.attestedTime, time_evidence_class: commitPoint.timeEvidenceClass, publication_ref: commitPoint.publicationRef, inter_witness_ambiguity: commitPoint.interWitnessAmbiguity, all_success_refs: commitPoint.allSuccessRefs },
      witness_receipts: attempts.map((a) => compactWitnessReceipt(a.classification, a)),
      label: 'host/witness-attested — not cryptographic proof',
    },
  });
  for (const a of attempts) {
    if (a.classification.outcome !== 'SUCCESS') {
      events = appendInstrumentEvent(events, lockSha256, { event_id: ulidGen(), type: 'witness-degraded', at: nowIso(), payload: { witness: a.witness, receipt: compactWitnessReceipt(a.classification, a) } });
    }
  }
  // P10 — admission BEFORE OTS (ratified sequencing clarification).
  const admission = admitInstrument({ recordRoot, instrumentId, canonicalBytes, events });
  // P11 — OTS stamping in the same pipeline run, AFTER admission. Scripted
  // stamp only in BUILD 03 (production stamping structurally prohibited).
  let anchor = null;
  if (ctx.otsStamp) {
    const stampEvidence = ctx.otsStamp({ lockedBytes: canonicalBytes, lockSha256 });
    let proof = null;
    if (stampEvidence.proofBytes) proof = writePendingProof(admission.dir, stampEvidence.proofBytes, ulidGen);
    const cls = classifyAnchorAttempt(stampEvidence);
    events = appendInstrumentEvent(events, lockSha256, { event_id: ulidGen(), type: 'anchor-requested', at: nowIso(), payload: { requested_at: nowIso(), well_formed: !!stampEvidence.wellFormed, calendars: stampEvidence.calendars || [], tooling_error: stampEvidence.toolingError || null, proof_ref: proof ? proof.filename : null, classification: cls } });
    fs.writeFileSync(path.join(admission.dir, 'events.ndjson'), serializeNdjson(events));
    anchor = { classification: cls, proof };
  }
  // P12 — close the journal (retained as history; never deleted under uncertainty).
  journal.setPhase(stagingRoot, instrumentId, 'COMPLETED', { admittedAt: nowIso() });
  return { status: 'FILED_LOCKED', instrumentId, lockSha256, filedAt, commitPoint, admission, anchor, events };
}

// ── Exact-byte retry + Telegram/Git catch-up for an already-locked run ──
// Reads bytes from the durable journal; NO code path to canonicalization.
function retryWitnessCatchUp({ stagingRoot, recordRoot, instrumentId, witness, transports, telegramMode, ulidGen, nowIso }) {
  nowIso = nowIso || (() => new Date().toISOString());
  const st = journal.loadRun(stagingRoot, instrumentId);
  if (!st || !st.commitPoint) throw new Error('catch-up requires a run with a recorded commit point');
  const canonicalBytes = journal.loadBytes(stagingRoot, instrumentId);
  if (!canonicalBytes) throw new Error('catch-up: durable bytes missing — integrity fault');
  const lockSha256 = st.lockSha256;
  const a = witness === 'git'
    ? attemptGitWitness({ stagingRoot, instrumentId, lockSha256, transports, nowIso })
    : attemptTelegramWitness({ stagingRoot, instrumentId, lockSha256, transports, telegramMode: telegramMode || 'MOCK', nowIso });
  if (a.classification.outcome === 'SUCCESS' && witness === 'git') {
    // Frozen case 3: repo catches up carrying the witness publication_ref;
    // bytes byte-identical (admitInstrument enforces it).
    return { caughtUp: true, classification: a.classification, bytesSha256: crypto.createHash('sha256').update(canonicalBytes).digest('hex') };
  }
  return { caughtUp: a.classification.outcome === 'SUCCESS', classification: a.classification };
}

// ── CRASH / STARTUP RECOVERY (rule R + AD-1 strengthening) ──────────────
// Re-resolves every open/held run from readback evidence. PUBLIC EVIDENCE
// OUTRANKS THE LOCAL JOURNAL: a discovered public success is the commit
// point at its attested time regardless of local phase.
function recoverStartup({ stagingRoot, transports, telegramMode, nowMs }) {
  nowMs = nowMs || (() => Date.now());
  const results = {};
  for (const id of journal.listRuns(stagingRoot)) {
    const st = journal.loadRun(stagingRoot, id);
    if (!['RUNNING', 'PUBLICATION_RECONCILIATION_HOLD', 'COMMIT_POINT_REACHED'].includes(st.phase)) { results[id] = { phase: st.phase, action: 'none' }; continue; }
    // Re-probe every PENDING attempt via readback.
    const updated = st.attempts.map((a) => ({ ...a }));
    for (let i = 0; i < updated.length; i++) {
      const a = updated[i];
      if (a.outcome !== 'PENDING') continue;
      if (a.witness === 'git') {
        let anon, auth;
        try { anon = transports.git.anonReadback({ instrumentId: id }); } catch (_) { anon = { available: false }; }
        try { auth = transports.git.authReadback({ instrumentId: id }); } catch (_) { auth = { available: false }; }
        const cls = classifyGitAttempt({ push: { boundaryCrossed: true, accepted: null, definitiveRejection: false }, authReadback: auth, anonReadback: anon, lockSha256: st.lockSha256 });
        // A readback-only reclassification can prove presence (SUCCESS); it
        // can never prove git absence here without a definitive rejection,
        // so non-found stays PENDING/UNCERTAIN — deliberately conservative.
        if (cls.outcome === 'SUCCESS') { journal.recordAttemptResult(stagingRoot, id, i, { outcome: 'CONFIRMED_PUBLISHED', evidence: { recovery: true, classification: cls } }); updated[i] = { ...a, outcome: 'CONFIRMED_PUBLISHED', classification: cls }; }
      } else if (a.witness === 'telegram') {
        let rb; try { rb = transports.telegram.publicReadback({ instrumentId: id, lockSha256: st.lockSha256 }); } catch (_) { rb = { available: false }; }
        if (rb && rb.available && rb.found) {
          const cls = classifyTelegramAttempt({ send: { boundaryCrossed: true, ok: true, messageId: rb.messageId || null, hostDate: rb.observedAt || null }, publicReadback: rb, instrumentId: id, lockSha256: st.lockSha256 }, telegramMode || 'MOCK');
          if (cls.outcome === 'SUCCESS') { journal.recordAttemptResult(stagingRoot, id, i, { outcome: 'CONFIRMED_PUBLISHED', evidence: { recovery: true, classification: cls } }); updated[i] = { ...a, outcome: 'CONFIRMED_PUBLISHED', classification: cls }; }
        } else if (rb && rb.available && rb.confirmedFailed === true) {
          // Only a transport-level DEFINITIVE non-publication proof (mockable;
          // production semantics are the AD-3 gated question) resolves to failure.
          journal.recordAttemptResult(stagingRoot, id, i, { outcome: 'CONFIRMED_FAILED', evidence: { recovery: true, readback: rb } });
          updated[i] = { ...a, outcome: 'CONFIRMED_FAILED' };
        }
      }
    }
    const fresh = journal.loadRun(stagingRoot, id);
    const published = fresh.attempts.find((a) => a.outcome === 'CONFIRMED_PUBLISHED');
    if (published && !fresh.commitPoint) {
      const cls = published.evidence && published.evidence.classification ? published.evidence.classification : (published.evidence ? published.evidence.recoveryClassification : null);
      const cp = { witness: published.witness, attestedTime: (cls && cls.attestedTime) || null, timeEvidenceClass: (cls && cls.timeEvidenceClass) || 'READBACK_OBSERVATION', publicationRef: (cls && cls.publicationRef) || null, allSuccessRefs: [(cls && cls.publicationRef) || null].filter(Boolean), interWitnessAmbiguity: null, recoveredFromPublicEvidence: true };
      journal.recordCommitPoint(stagingRoot, id, cp);
      results[id] = { phase: 'RESOLVED_COMMIT_POINT', action: 'commit point recovered from public evidence (public evidence outranks local journal)', commitPoint: cp };
      continue;
    }
    if (fresh.commitPoint) { results[id] = { phase: fresh.phase, action: 'commit point already recorded; admission catch-up pending' }; continue; }
    // No success anywhere: proven Δ/hold machinery decides.
    const expiry = fresh.phase === 'PUBLICATION_RECONCILIATION_HOLD'
      ? reconcileHold({ ...fresh, filedAt: fresh.filedAt }, fresh.attempts)
      : evaluateExpiry({ filedAt: fresh.filedAt, generatedBytesRef: 'journal', lockHashRef: fresh.lockSha256, instrumentId: id, attempts: fresh.attempts }, nowMs());
    if (expiry.phase === 'EXPIRED_CASE_A' || expiry.phase === 'RESOLVED_RELEASED_CASE_A') {
      journal.destroyBytesCaseA(stagingRoot, id, expiry.phase);
      results[id] = { phase: expiry.phase, action: 'Case A: bytes destroyed; DRAFT retained; fresh run permitted' };
    } else if (expiry.phase === 'PUBLICATION_RECONCILIATION_HOLD') {
      journal.setPhase(stagingRoot, id, 'PUBLICATION_RECONCILIATION_HOLD', { holdActive: true, secondHashProhibitedForId: id });
      results[id] = { phase: 'PUBLICATION_RECONCILIATION_HOLD', action: 'hold persists (no maximum duration by design)' };
    } else {
      results[id] = { phase: expiry.phase, action: 'within tolerance; run remains open' };
    }
  }
  return results;
}

module.exports = { runLockRun, recoverStartup, retryWitnessCatchUp, gateP4, admitInstrument, finishFromCommitPoint };
