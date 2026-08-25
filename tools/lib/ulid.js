// Minimal ULID implementation (Crockford base32, 48-bit time + 80-bit random),
// BUILD 03. Injectable time/random sources so fixtures are deterministic.
// This generates concurrent-object ids per the ratified D-6 namespace rules;
// it is NOT an authority for FCC-I-*/FCC-F-*/FCC-C-* counters.
const crypto = require('crypto');
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTime(ms) {
  let out = '';
  for (let i = 9; i >= 0; i--) out += B32[Math.floor(ms / Math.pow(32, i)) % 32];
  return out;
}
function encodeRandom(bytes) { // 10 bytes -> 16 chars
  let out = '', acc = 0, bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(acc >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(acc << (5 - bits)) & 31];
  return out.slice(0, 16);
}
function makeUlidGenerator({ nowMs, randomBytes } = {}) {
  const now = nowMs || (() => Date.now());
  const rand = randomBytes || ((n) => crypto.randomBytes(n));
  return () => encodeTime(now()) + encodeRandom(rand(10));
}
// Deterministic generator for fixtures: fixed time, counter-based "random".
function makeDeterministicUlidGenerator(startMs = 1700000000000) {
  let n = 0;
  return makeUlidGenerator({
    nowMs: () => startMs + n,
    randomBytes: (len) => { n += 1; const b = Buffer.alloc(len); b.writeUInt32BE(n, len - 4); return b; },
  });
}
module.exports = { makeUlidGenerator, makeDeterministicUlidGenerator };
