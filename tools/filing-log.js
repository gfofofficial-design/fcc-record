#!/usr/bin/env node
// FCC PUBLIC FILING LOG FOUNDATION.
//
// Implements Doctrine §F3's public intent-registration mechanism: the
// append-only sequence work begins -> public Filing Log entry -> FCC-I-*
// reserved -> DRAFT exists -> PRELOCK work may proceed.
//
// This module does NOT file or lock a Capital Instrument. It reads/writes
// an in-memory or on-disk event array; publication to the real public
// repository (the "independently observable" boundary, §5) is an operator
// action outside this module's scope, exactly as production Lock Run
// publication is outside tools/lock-run.js's scope.
//
// AUTHORITY BOUNDARY (item 5): an FCC-I-* id is authoritative only once
// its filing-opened event is independently observable in the public
// repository. This module can construct and validate a candidate event,
// but constructing one locally does NOT make an id authoritative -- only
// publication does. Nothing here claims cryptographic precedence beyond
// what Git publication proves, and nothing here is a Capital Instrument
// COMMIT POINT.
const fs = require('fs'), path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { buildEvent, verifyEventChain, ZERO_ROOT } = require('./lib/event-hash.js');

const SCHEMA_PATH = path.join(__dirname, '../governance/schemas/v1/filing-log-event.schema.json');

function buildValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')));
}

function formatId(prefix, n) {
  if (n < 1 || n > 999999) throw new Error(`${prefix} sequence out of six-digit range`);
  return `${prefix}-${String(n).padStart(6, '0')}`;
}

// Reads the current authoritative sequence position from an existing,
// hash-chain-verified event array. Never reuses a number even if the
// entry it belonged to was later abandoned (item 2: gaps permitted,
// no renumbering, no recycling).
function computeNextIds(existingEvents) {
  let maxFilingSeq = 0, maxInstrumentSeq = 0;
  for (const e of existingEvents) {
    if (e.type === 'filing-opened') {
      const fSeq = parseInt(e.filing_id.split('-')[2], 10);
      const iSeq = parseInt(e.payload.instrument_id.split('-')[2], 10);
      if (fSeq > maxFilingSeq) maxFilingSeq = fSeq;
      if (iSeq > maxInstrumentSeq) maxInstrumentSeq = iSeq;
    }
  }
  return { nextFilingId: formatId('FCC-F', maxFilingSeq + 1), nextInstrumentId: formatId('FCC-I', maxInstrumentSeq + 1) };
}

// Constructs and validates a filing-opened event (the reservation act).
// This is the ONLY function in the entire fcc-record tree that mints a new
// FCC-I-* id -- and it does so by computing the next sequence position
// from the authoritative existing chain, never arbitrarily.
// `existingEvents` must already be hash-chain-verified by the caller
// before being trusted as "authoritative" -- this function itself only
// checks internal consistency of the event it builds.
// QA CLOSURE item 3: openFiling() is the sole ID-minting primitive and
// therefore MUST fail closed on an unverified or corrupt base -- it does
// not trust the caller to have already verified the chain. This does not
// replace CI uniqueness enforcement (a second line of defense); it makes
// the minting primitive itself refuse to propose an ID from bad input.
function verifyAuthorityBase(existingEvents) {
  const chainResult = verifyEventChain(existingEvents, ZERO_ROOT);
  if (!chainResult.ok) {
    throw new Error(`REFUSED — BROKEN AUTHORITY BASE: the supplied Filing Log event chain does not verify (${chainResult.reason}). No ID may be proposed from an unverified base.`);
  }
  const filingIds = existingEvents.filter(e => e.type === 'filing-opened').map(e => e.filing_id);
  const instrumentIds = existingEvents.filter(e => e.type === 'filing-opened').map(e => e.payload.instrument_id);
  if (new Set(filingIds).size !== filingIds.length) {
    throw new Error('REFUSED — DUPLICATE filing_id already present in the supplied base. Refusing to mint from a corrupt authority base.');
  }
  if (new Set(instrumentIds).size !== instrumentIds.length) {
    throw new Error('REFUSED — DUPLICATE instrument_id already present in the supplied base. Refusing to mint from a corrupt authority base.');
  }
}

// Reusable precondition gate for future assessment-specific tooling
// (governance/procedures/work-begin-boundary.md). Refuses unless a
// filing-opened event for filingId exists in an already-verified chain --
// i.e., unless registration is independently observable before any
// assessment-specific substantive act proceeds.
function assertWorkPermitted(filingId, verifiedEvents) {
  verifyAuthorityBase(verifiedEvents); // fail closed on a broken base here too
  const registered = verifiedEvents.some(e => e.type === 'filing-opened' && e.filing_id === filingId);
  if (!registered) {
    throw new Error(`WORK-BEGIN BOUNDARY VIOLATION: no independently observable Filing Log registration exists for ${filingId}. Assessment-specific work (evidence retrieval, analysis, drafting, scoring, benchmark selection, model/AI analysis, judgment formation, or workspace/session/branch creation) may not proceed until registration is public.`);
  }
  return true;
}

function openFiling({ subject, rationale, proposalSource, existingEvents, eventIdGenerator, atOverrideForTesting }) {
  if (!subject || !rationale) throw new Error('subject and rationale are required to open a filing');
  verifyAuthorityBase(existingEvents);
  const { nextFilingId, nextInstrumentId } = computeNextIds(existingEvents);
  const prevHash = existingEvents.length === 0 ? ZERO_ROOT : existingEvents[existingEvents.length - 1].event_sha256;
  const payload = { subject, rationale, instrument_id: nextInstrumentId };
  if (proposalSource) payload.proposal_source = proposalSource;
  const event = buildEvent({
    event_id: eventIdGenerator(),
    type: 'filing-opened',
    at: atOverrideForTesting || new Date().toISOString(),
    filing_id: nextFilingId,
    payload,
  }, prevHash);

  const validate = buildValidator();
  if (!validate(event)) { const err = new Error('FILING-OPENED EVENT SCHEMA VALIDATION FAILED'); err.schemaErrors = validate.errors; throw err; }
  return event;
}

function abandonFiling({ filingId, abandonmentReason, existingEvents, eventIdGenerator, atOverrideForTesting }) {
  if (!abandonmentReason) throw new Error('abandonment_reason is required');
  const openEvent = existingEvents.find(e => e.type === 'filing-opened' && e.filing_id === filingId);
  if (!openEvent) throw new Error(`cannot abandon ${filingId}: no filing-opened event found for it`);
  const alreadyAbandoned = existingEvents.some(e => e.type === 'filing-abandoned' && e.filing_id === filingId);
  if (alreadyAbandoned) throw new Error(`${filingId} is already abandoned`);
  const prevHash = existingEvents[existingEvents.length - 1].event_sha256;
  const event = buildEvent({
    event_id: eventIdGenerator(),
    type: 'filing-abandoned',
    at: atOverrideForTesting || new Date().toISOString(),
    filing_id: filingId,
    payload: { abandonment_reason: abandonmentReason },
  }, prevHash);
  const validate = buildValidator();
  if (!validate(event)) { const err = new Error('FILING-ABANDONED EVENT SCHEMA VALIDATION FAILED'); err.schemaErrors = validate.errors; throw err; }
  return event;
}

// AUTHORITY LOOKUP (item 9) -- what a future production Lock Run must
// eventually require before consuming an id. Given a candidate
// instrument_id and the full authoritative event array (already
// independently fetched from the public repository by the caller), verify:
//   - the id exists in the log
//   - the chain verifies end to end
//   - the id is not duplicated across multiple filing-opened events
//   - the id has not been marked abandoned
//   - the id is not already associated with a completed public lock binding
function verifyInstrumentIdAuthority(instrumentId, allEvents) {
  const chainResult = verifyEventChain(allEvents, ZERO_ROOT);
  if (!chainResult.ok) return { authoritative: false, reason: 'HASH CHAIN INVALID: ' + chainResult.reason };

  const openings = allEvents.filter(e => e.type === 'filing-opened' && e.payload.instrument_id === instrumentId);
  if (openings.length === 0) return { authoritative: false, reason: 'NOT FOUND: no filing-opened event reserves this id' };
  if (openings.length > 1) return { authoritative: false, reason: 'DUPLICATE: more than one filing-opened event claims this id — log integrity violation' };

  const filingId = openings[0].filing_id;
  const abandoned = allEvents.some(e => e.type === 'filing-abandoned' && e.filing_id === filingId);
  if (abandoned) return { authoritative: false, reason: 'ABANDONED: this filing has been marked abandoned' };

  const alreadyFiled = allEvents.some(e => e.type === 'filing-filed' && e.filing_id === filingId);
  if (alreadyFiled) return { authoritative: false, reason: 'ALREADY FILED: this id is already associated with a completed public lock binding' };

  return { authoritative: true, filingId };
}

module.exports = { computeNextIds, openFiling, abandonFiling, verifyInstrumentIdAuthority, verifyAuthorityBase, assertWorkPermitted, formatId };
