// BUILD 03 — WITNESS TRANSPORT ABSTRACTION + DETERMINISTIC MOCKS.
//
// HARD PROHIBITIONS (this pass): no real Git witness publication, no real
// Telegram send, no production credentials. Enforced STRUCTURALLY: the
// production transport constructors below throw. Only mock transports are
// constructible, and every mock result is a scripted, deterministic object.
//
// Transport interface (git):
//   push({instrumentId, files})            -> {boundaryCrossed, accepted, definitiveRejection, hostPushTime?, commitSha?, error?}
//   authReadback({instrumentId})           -> {available, commitFound, blobSha256?, hostAttestedTime?, commitSha?}
//   anonReadback({instrumentId})           -> {available, commitFound, blobSha256?}   // AD-4: NORMATIVE independent-observability check
// Transport interface (telegram):
//   sendMessage({text})                    -> {boundaryCrossed, ok, definitiveError4xx, messageId?, hostDate?, error?}
//   publicReadback({messageId, instrumentId, lockSha256}) -> {available, found, contentSha256?, observedAt?}
const crypto = require('crypto');

// Frozen witness message format (BUILD 03 architecture §4a; payload fields per D-2).
function buildWitnessMessage(instrumentId, lockSha256) {
  if (!/^FCC-(I|TEST-I)-/.test(instrumentId)) throw new Error('witness message: invalid instrument id');
  if (!/^[0-9a-f]{64}$/.test(lockSha256)) throw new Error('witness message: invalid lock_sha256');
  return [
    'FCC-WITNESS v1',
    `instrument_id: ${instrumentId}`,
    `lock_sha256: ${lockSha256}`,
    'class: attestation-grade — not cryptographic proof',
    `record: record/instruments/${instrumentId}/locked.json`,
  ].join('\n');
}
function parseWitnessMessage(text) {
  const lines = String(text).split('\n');
  if (lines[0] !== 'FCC-WITNESS v1') return null;
  const get = (k) => (lines.find((l) => l.startsWith(k + ': ')) || '').slice(k.length + 2);
  const instrumentId = get('instrument_id'), lockSha256 = get('lock_sha256');
  if (!instrumentId || !/^[0-9a-f]{64}$/.test(lockSha256)) return null;
  return { instrumentId, lockSha256 };
}

// ── Deterministic mocks ─────────────────────────────────────────────────
// script: { push: [result, ...], authReadback: [...], anonReadback: [...] }
// Each call consumes the next scripted result; running past the script is a
// test bug and throws (no accidental nondeterminism).
function scripted(queueName, queue) {
  return (args) => {
    if (!queue.length) throw new Error(`mock ${queueName}: script exhausted`);
    const next = queue.shift();
    return typeof next === 'function' ? next(args) : { ...next };
  };
}
function makeMockGitTransport(script) {
  const calls = { push: [], authReadback: [], anonReadback: [] };
  const t = {
    kind: 'git', mock: true,
    push: (a) => { calls.push.push(a); return scripted('git.push', script.push || [])(a); },
    authReadback: (a) => { calls.authReadback.push(a); return scripted('git.authReadback', script.authReadback || [])(a); },
    anonReadback: (a) => { calls.anonReadback.push(a); return scripted('git.anonReadback', script.anonReadback || [])(a); },
    _calls: calls,
  };
  // Non-destructive introspection helpers used by scripts
  return t;
}
function makeMockTelegramTransport(script) {
  const calls = { sendMessage: [], publicReadback: [] };
  return {
    kind: 'telegram', mock: true,
    sendMessage: (a) => { calls.sendMessage.push(a); return scripted('tg.sendMessage', script.sendMessage || [])(a); },
    publicReadback: (a) => { calls.publicReadback.push(a); return scripted('tg.publicReadback', script.publicReadback || [])(a); },
    _calls: calls,
  };
}

// Convenience: scripted SUCCESS results that are internally consistent with
// a given (id, hash) pair — fixtures use these to avoid hand-building evidence.
function gitSuccessScript(instrumentId, lockSha256, hostTime, commitSha = 'a'.repeat(40)) {
  return {
    push: [{ boundaryCrossed: true, accepted: true, definitiveRejection: false, hostPushTime: hostTime, commitSha }],
    authReadback: [{ available: true, commitFound: true, blobSha256: lockSha256, hostAttestedTime: hostTime, commitSha }],
    anonReadback: [{ available: true, commitFound: true, blobSha256: lockSha256 }],
  };
}
function telegramSuccessScript(instrumentId, lockSha256, hostDate, messageId = 101) {
  const msg = buildWitnessMessage(instrumentId, lockSha256);
  return {
    sendMessage: [{ boundaryCrossed: true, ok: true, definitiveError4xx: false, messageId, hostDate }],
    publicReadback: [{ available: true, found: true, contentSha256: crypto.createHash('sha256').update(msg).digest('hex'), observedAt: hostDate }],
  };
}

// ── Production transports: STRUCTURALLY PROHIBITED THIS PASS ───────────
function productionGitTransport() {
  throw new Error('PRODUCTION_TRANSPORT_NOT_AUTHORIZED: real Git witness publication is prohibited in BUILD 03 (implementation pass). A production transport is a later explicit gate.');
}
function productionTelegramTransport() {
  throw new Error('PRODUCTION_TRANSPORT_NOT_AUTHORIZED: real Telegram sends are prohibited in BUILD 03 (implementation pass). Real Federation-channel verification is a later explicit gate (AD-3).');
}

module.exports = {
  buildWitnessMessage, parseWitnessMessage,
  makeMockGitTransport, makeMockTelegramTransport,
  gitSuccessScript, telegramSuccessScript,
  productionGitTransport, productionTelegramTransport,
};
