#!/usr/bin/env node
// REAL byte-equality verification (QA-1.1 item 2), not a CRLF heuristic.
// For every byte-exact artifact: (1) read the authoritative committed git
// blob bytes via `git cat-file blob`, SHA-256 them, and compare to the
// recorded expected hash in governance/evidence/byte-exact-manifest.json;
// (2) independently read the working-tree checkout of the same path and
// SHA-256 those bytes, proving checkout == blob on THIS OS. Any mismatch —
// whether against the recorded manifest or between blob and checkout — fails.
// Designed to run identically and be meaningful on Linux, macOS, and Windows
// CI runners (git cat-file + Node's fs are both cross-platform; no shell
// text-mode assumptions).
const { execSync } = require('child_process');
const fs = require('fs'), crypto = require('crypto');

const manifest = JSON.parse(fs.readFileSync('governance/evidence/byte-exact-manifest.json', 'utf8'));
let fail = false;

for (const entry of manifest.entries) {
  const p = entry.path;
  // Authoritative committed blob bytes
  const blobHash = execSync(`git rev-parse HEAD:${p}`, { encoding: 'utf8' }).trim();
  const blobBytes = execSync(`git cat-file blob ${blobHash}`);
  const blobSha256 = crypto.createHash('sha256').update(blobBytes).digest('hex');

  // Working-tree checkout bytes (raw, no text-mode read)
  const checkoutBytes = fs.readFileSync(p);
  const checkoutSha256 = crypto.createHash('sha256').update(checkoutBytes).digest('hex');

  const blobMatchesManifest = blobSha256 === entry.content_sha256;
  const checkoutMatchesBlob = checkoutSha256 === blobSha256;

  console.log((blobMatchesManifest ? 'PASS ' : 'FAIL ') + p + ' blob-vs-manifest ' + blobSha256.slice(0,16) + '…');
  console.log((checkoutMatchesBlob ? 'PASS ' : 'FAIL ') + p + ' checkout-vs-blob  ' + checkoutSha256.slice(0,16) + '…');

  if (!blobMatchesManifest || !checkoutMatchesBlob) fail = true;
}

if (fail) { console.error('\nBYTE PRESERVATION CHECK FAILED — recorded hash, git blob, or checkout diverge.'); process.exit(1); }
console.log(`\nByte preservation verified: ${manifest.entries.length} artifacts, blob==manifest and checkout==blob on this OS.`);
