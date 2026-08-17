#!/usr/bin/env node
// Builds/updates governance/evidence/byte-exact-manifest.json: SHA-256 of the
// AUTHORITATIVE GIT BLOB bytes (via `git cat-file blob`, not a working-tree
// read) for every artifact in the byte-exact set. This manifest is the
// recorded-expected-hash source that verify-byte-preservation.js checks
// checkouts against on every OS.
const { execSync } = require('child_process');
const fs = require('fs');
const BYTE_EXACT_PATHS = [
  'governance/frozen/FCC_PRODUCT_BLUEPRINT_V1_1_1.md',
  'governance/frozen/FCC_CAPITAL_DOCTRINE_V0_1_1.md',
  'governance/frozen/FCC_CAPITAL_INSTRUMENT_SPEC_V0_1_1.md',
  'governance/keys/key-TEST-000.pub.pem',
];
const entries = BYTE_EXACT_PATHS.map(p => {
  const blobHash = execSync(`git rev-parse HEAD:${p}`, {encoding:'utf8'}).trim();
  const blobBytes = execSync(`git cat-file blob ${blobHash}`);
  const crypto = require('crypto');
  const sha256 = crypto.createHash('sha256').update(blobBytes).digest('hex');
  return { path: p, git_blob_sha1: blobHash, content_sha256: sha256, bytes: blobBytes.length };
});
fs.writeFileSync('governance/evidence/byte-exact-manifest.json', JSON.stringify({
  note: "content_sha256 is computed from the authoritative git blob bytes at HEAD (git cat-file blob), independent of any working-tree checkout transform.",
  byte_exact_set_definition: "locked bodies, annexes, OTS proofs, and snapshots (none exist yet — BUILD 02+) plus, at BUILD-01 foundation scope, the frozen governing documents and published intake public keys.",
  entries
}, null, 2) + '\n');
console.log('Manifest written:', entries.length, 'entries');
entries.forEach(e => console.log(' ', e.path, e.content_sha256.slice(0,16)+'…'));
