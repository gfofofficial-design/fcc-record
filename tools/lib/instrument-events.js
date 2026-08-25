// BUILD 03 — INSTRUMENT EVENT HELPERS (frozen vocabulary only).
//
// AD-2 RATIFIED: permanent compact witness receipts live INSIDE the
// existing hash-chained event payloads (filed-locked / published /
// witness-degraded / witness-completed / anchor-requested /
// anchor-confirmed). No new record artifact class exists. Raw witness
// captures stay in the operational journal only.
//
// Event hash law is the proven BUILD 02 implementation (event-hash.js):
// event_sha256 = SHA256(RFC8785(event minus event_sha256)),
// prev_event_sha256 inside the object; instrument chains root at lock_sha256.
const { buildEvent, verifyEventChain } = require('./event-hash.js');

const INSTRUMENT_EVENT_TYPES = [
  'filed-locked', 'published', 'witness-degraded', 'witness-completed',
  'anchor-requested', 'anchor-confirmed', 'annex-added', 'state-transition',
  'challenge-received', 'resolution-recorded',
];

function appendInstrumentEvent(events, lockSha256, partial) {
  if (!INSTRUMENT_EVENT_TYPES.includes(partial.type)) throw new Error(`unknown instrument event type: ${partial.type} — the frozen vocabulary is closed; adding a type is an architecture decision`);
  if (!partial.event_id) throw new Error('event_id (ULID) required');
  if (!partial.at) throw new Error('at (timestamp) required');
  const prev = events.length === 0 ? lockSha256 : events[events.length - 1].event_sha256;
  if (events.length === 0 && partial.type !== 'filed-locked') throw new Error('an instrument chain must begin with filed-locked (genesis roots at lock_sha256)');
  const ev = buildEvent(partial, prev);
  return [...events, ev];
}

// Compact witness receipt (permanent, event-payload-resident).
function compactWitnessReceipt(classification, attemptMeta) {
  return {
    witness: attemptMeta.witness,
    sent_at: attemptMeta.sentAt,
    outcome: classification.outcome,
    attested_time: classification.attestedTime || null,
    time_evidence_class: classification.timeEvidenceClass || null,
    publication_ref: classification.publicationRef || null,
    reason: classification.reason,
    label: 'host/witness-attested — not cryptographic proof',
  };
}

function serializeNdjson(events) { return events.map((e) => JSON.stringify(e)).join('\n') + '\n'; }
function verifyInstrumentChain(events, lockSha256) { return verifyEventChain(events, lockSha256); }

module.exports = { INSTRUMENT_EVENT_TYPES, appendInstrumentEvent, compactWitnessReceipt, serializeNdjson, verifyInstrumentChain };
