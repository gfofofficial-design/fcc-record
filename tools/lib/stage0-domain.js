'use strict';
// Pure fixture-workbench mechanics. This module never writes a production record.
const crypto = require('crypto');
const canonicalize = require('canonicalize');
const { dualCanonicalize } = require('./canonicalize');
const DAY = 86400000;
const CATEGORIES = ['flawed-premise', 'missing-evidence', 'ignored-risk', 'inappropriate-sizing', 'bad-benchmark', 'conflict-of-interest', 'manipulable-resolution-criterion', 'invalid-assumption'];
const DISPOSITIONS = ['RESOLVED-CORRECT', 'RESOLVED-INCORRECT', 'CONCEDED', 'VOID', 'INVALIDATED-BY-DOCTRINE'];
const hash = value => crypto.createHash('sha256').update(canonicalize(value)).digest('hex');
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('A valid UTC timestamp is required');
  return Date.parse(value);
}
function fixtureId(id) { if (typeof id !== 'string' || !/^FCC-TEST-[A-Z0-9-]{1,64}$/.test(id)) throw new Error('Only FCC-TEST identifiers are accepted in the workbench'); return id; }
function validateChallenge(input) {
  const problems = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['Submission must be an object'];
  if (!CATEGORIES.includes(input.category)) problems.push('Choose one frozen challenge category');
  if (typeof input.identity !== 'string' || !/^FCC-TEST-[A-Z0-9-]{1,64}$/.test(input.identity)) problems.push('A test identity is required');
  if (typeof input.claim !== 'string' || !input.claim.trim() || input.claim.length > 12000) problems.push('Claim must contain 1–12000 characters');
  if (!Array.isArray(input.supporting_evidence) || !input.supporting_evidence.length || input.supporting_evidence.some(e => !e || typeof e.source_url !== 'string' || !/^https?:\/\//.test(e.source_url) || !/^[a-f0-9]{64}$/.test(e.content_sha256 || ''))) problems.push('Evidence requires a source URL and SHA-256');
  return problems;
}
function responseDeadline(receivedAt) { return new Date(timestamp(receivedAt) + 7 * DAY).toISOString(); }
function responseStatus(challenge, now) {
  if (challenge.status === 'RETURNED-MALFORMED') return { deadline: null, breached: false };
  const deadline = responseDeadline(challenge.received_at);
  return { deadline, breached: timestamp(challenge.responded_at || now) > timestamp(deadline) };
}
function evaluateCriteria(locked, readings) {
  if (!Array.isArray(locked.resolution_criteria) || !locked.resolution_criteria.length) throw new Error('Locked criteria are required');
  const ops = { '<': (a,b) => a < b, '<=': (a,b) => a <= b, '>': (a,b) => a > b, '>=': (a,b) => a >= b, '==': (a,b) => a === b, '!=': (a,b) => a !== b };
  return locked.resolution_criteria.map(c => {
    const r = readings.find(x => x.criterion_id === c.criterion_id);
    const source = locked.resolution_sources.find(x => x.criterion_id === c.criterion_id);
    if (!r || !source || ![source.primary_source, source.fallback_source].filter(Boolean).includes(r.source)) throw new Error('Reading must bind to a locked source: ' + c.criterion_id);
    if (r.source !== source.primary_source && r.primary_unavailable !== true) throw new Error('Fallback use requires primary-unavailable evidence');
    if (timestamp(r.measured_at) < timestamp(locked.horizon)) throw new Error('Measurement precedes the locked horizon');
    if (!Number.isFinite(r.value) || !Number.isFinite(c.threshold) || !ops[c.comparator]) throw new Error('Unsupported or nonnumeric criterion');
    if (!r.archive || hash(r.archive) !== r.archive_sha256 || r.archive.value !== r.value || r.archive.source !== r.source || r.archive.measured_at !== r.measured_at) throw new Error('Archived reading does not bind to the supplied measurement');
    return { criterion_id: c.criterion_id, met: ops[c.comparator](r.value, c.threshold), measured_at: r.measured_at, archive_sha256: r.archive_sha256 };
  });
}
function deriveResolution(instrument, input) {
  fixtureId(instrument.instrument_id);
  if (instrument.state !== 'OPEN') throw new Error('Only OPEN fixtures can be resolved');
  if (timestamp(input.at) < timestamp(instrument.opened_at) + 3 * DAY) throw new Error('Minimum OPEN duration is 72 hours');
  if (timestamp(input.at) < timestamp(instrument.locked.horizon)) throw new Error('Horizon has not passed');
  if (!instrument.counter_thesis || !instrument.counter_thesis.content) throw new Error('Counter-thesis is required');
  if (!instrument.anchor || !instrument.anchor.fixture_only || timestamp(instrument.anchor.blocktime) > timestamp(input.at)) throw new Error('A confirmed fixture anchor is required');
  const pending = instrument.challenges.filter(c => !['RETURNED-MALFORMED', 'CONSOLIDATED', 'UPHELD', 'PARTIALLY-UPHELD', 'NOT-UPHELD'].includes(c.status));
  if (pending.length) throw new Error('Resolve pending challenges before terminal evaluation');
  if (input.operator_confirmed !== true) throw new Error('Operator confirmation is required');
  if ([input.conceded, input.invalidated, input.void].filter(x => x === true).length > 1) throw new Error('Disposition overrides are mutually exclusive');
  if (input.invalidated && (typeof input.defect !== 'string' || !input.defect.trim())) throw new Error('Invalidation requires a recorded filing-time defect');
  let results;
  if (input.void === true) {
    // VOID must not be a convenient override of available measurements.
    if (!Array.isArray(input.unavailable_sources) || !input.unavailable_sources.length) throw new Error('VOID requires archived source-failure evidence');
    for (const source of instrument.locked.resolution_sources) {
      for (const name of [source.primary_source, source.fallback_source].filter(Boolean)) {
        const failure = input.unavailable_sources.find(x => x.source === name);
        if (!failure || !failure.archive || failure.archive.unavailable !== true || failure.archive.source !== name || domainHashFailure(failure)) throw new Error('VOID requires exhaustion of every locked source and fallback');
      }
    }
    if ((input.readings || []).length) throw new Error('Partial-data VOID needs a separately specified evaluation procedure; this workbench refuses it');
    results = [];
  } else results = evaluateCriteria(instrument.locked, input.readings || []);
  if (results.some(r => timestamp(r.measured_at) > timestamp(input.at))) throw new Error('Measurement is in the future');
  let disposition = results.every(r => r.met) ? 'RESOLVED-CORRECT' : 'RESOLVED-INCORRECT';
  if (input.conceded === true) disposition = 'CONCEDED';
  if (input.invalidated === true) disposition = 'INVALIDATED-BY-DOCTRINE';
  if (input.void === true) disposition = 'VOID';
  const breaches = instrument.challenges.filter(c => responseStatus(c, input.at).breached).map(c => c.challenge_id);
  const violated = disposition === 'INVALIDATED-BY-DOCTRINE' || breaches.length > 0 || instrument.conduct_violations.length > 0;
  const outcome = ['INVALIDATED-BY-DOCTRINE','VOID'].includes(disposition) ? 'UNSCORED' : disposition === 'RESOLVED-CORRECT' ? 'CORRECT' : 'INCORRECT';
  const anchored = results.length > 0 && results.every(r => timestamp(instrument.anchor.blocktime) < timestamp(r.measured_at));
  return { terminal_disposition: disposition, outcome, process: violated ? 'VIOLATED' : 'COMPLIANT', informational_outcome: disposition === 'INVALIDATED-BY-DOCTRINE' ? (results.every(r => r.met) ? 'CORRECT' : 'INCORRECT') : null, response_breaches: breaches, criteria: results, resolved_at: input.at, ordering_evidence: { level: anchored ? 'ANCHORED' : 'PUBLISHED', fixture_only: true, label: anchored ? 'Simulated anchor; not Bitcoin proof' : 'PRECEDENCE: NOT INDEPENDENTLY PROVEN' } };
}
function domainHashFailure(failure) { return hash(failure.archive) !== failure.archive_sha256; }
function aggregates(instruments, filings = []) {
  const terminal = instruments.filter(i => i.state === 'TERMINAL');
  const scored = terminal.filter(i => !i.trivial && ['CORRECT','INCORRECT'].includes(i.resolution.outcome));
  const count = pred => terminal.filter(pred).length;
  const correct = scored.filter(i => i.resolution.outcome === 'CORRECT').length;
  return { label: 'DERIVED — fixture data only', instruments: instruments.length, terminal: terminal.length, dispositions: Object.fromEntries(DISPOSITIONS.map(d => [d, count(i => i.resolution.terminal_disposition === d)])), hit_rate: { numerator: correct, denominator: scored.length, value: scored.length ? correct / scored.length : null }, void: { numerator: count(i => i.resolution.terminal_disposition === 'VOID'), denominator: terminal.length }, trivial: instruments.filter(i => i.trivial).length, disputed: instruments.filter(i => i.disputed).length, process_violated: { numerator: count(i => i.resolution.process === 'VIOLATED'), denominator: instruments.length }, anchored_precedence: { numerator: count(i => i.resolution.ordering_evidence.level === 'ANCHORED'), denominator: terminal.length, fixture_only: true }, informational_outcomes: count(i => i.resolution.informational_outcome !== null), challenges: instruments.reduce((n,i) => n+i.challenges.length,0), abandonments: filings.filter(f => f.status === 'ABANDONED').length };
}
function verifyFixture(instrument) {
  const failures = [];
  try {
    fixtureId(instrument.instrument_id);
    const { bytes } = dualCanonicalize(instrument.locked);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== instrument.lock_sha256) failures.push('Locked-body hash mismatch');
    const chain = require('./event-hash').verifyEventChain(instrument.events, instrument.lock_sha256);
    if (!chain.ok) failures.push(chain.reason);
    const { events, ...snapshot } = instrument;
    if (!events.length || events[events.length - 1].payload?.snapshot_sha256 !== hash(snapshot)) failures.push('Projection is not bound to the last event');
    if (instrument.state === 'TERMINAL') {
      const recomputed = deriveResolution({ ...instrument, state: 'OPEN' }, instrument.resolution_input);
      if (canonicalize(recomputed) !== canonicalize(instrument.resolution)) failures.push('Resolution or scoring mismatch');
    }
  } catch (e) { failures.push(e.message); }
  return { valid: !failures.length, failures, scope: 'Fixture bytes, event chain, and mechanical scoring; not identity, source-truth, or Bitcoin proof verification' };
}
module.exports = { DAY, CATEGORIES, DISPOSITIONS, hash, timestamp, fixtureId, validateChallenge, responseDeadline, responseStatus, evaluateCriteria, deriveResolution, aggregates, verifyFixture };
