#!/usr/bin/env node
// Byte-exact manifest completeness (BUILD 01.2 item 5). Ensures CI cannot
// silently ignore a byte-exact-class artifact just because nobody updated
// the manifest. Walks the working tree for files matching a known
// byte-exact CLASS pattern and fails if any such file is absent from
// governance/evidence/byte-exact-manifest.json.
//
// Classes covered (per frozen architecture v0.1.2 §2/§19):
//   - frozen governing documents      governance/frozen/**/*.md
//   - published intake public keys    governance/keys/*.pem
//   - locked instrument bodies        record/instruments/*/locked.json
//   - immutable annex files           record/instruments/*/*.json (excl. locked.json)
//   - OTS proof files                 **/*.ots under record/
//
// NOT covered — genuinely deferred, not invented:
//   - periodic snapshot archives: the frozen architecture specifies a
//     snapshot CADENCE (kill/gate/halt + monthly) but no concrete
//     filename/path convention has been frozen yet. Binding that path is
//     a later decision, not something to guess here. This scanner
//     explicitly does not attempt to detect snapshot artifacts and says so
//     on every run so the gap is never silent.
const fs = require('fs'), path = require('path');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p.split(path.sep).join('/'));
  }
  return out;
}

function matchesByteExactClass(p) {
  if (/^governance\/frozen\/.*\.md$/.test(p)) return 'frozen-governing-document';
  if (/^governance\/keys\/.*\.pem$/.test(p)) return 'published-intake-public-key';
  if (/^record\/instruments\/[^/]+\/locked\.json$/.test(p)) return 'locked-instrument-body';
  if (/^record\/instruments\/[^/]+\/.*\.json$/.test(p) && !/\/locked\.json$/.test(p)) return 'immutable-annex';
  if (/^record\/.*\.ots$/.test(p)) return 'ots-proof';
  // F-3: authoritative raw Epoch 1 evidence transcripts must never drift silently
  if (/^governance\/evidence\/a1a2-.*\.txt$/.test(p)) return 'authoritative-raw-evidence';
  return null;
}

const manifest = JSON.parse(fs.readFileSync('governance/evidence/byte-exact-manifest.json', 'utf8'));
const registered = new Set(manifest.entries.map(e => e.path));

const allFiles = walk('governance').concat(walk('record'));
const unregistered = [];
for (const p of allFiles) {
  const cls = matchesByteExactClass(p);
  if (cls && !registered.has(p)) unregistered.push({ path: p, class: cls });
}

console.log(`Scanned ${allFiles.length} files under governance/ and record/.`);
console.log(`Manifest currently registers ${manifest.entries.length} byte-exact artifact(s).`);
console.log('NOTE: snapshot artifacts are NOT covered by this scanner — no concrete path is frozen yet (deferred, not invented).');

if (unregistered.length) {
  console.error('\nUNREGISTERED BYTE-EXACT ARTIFACT(S) DETECTED — manifest is incomplete:');
  unregistered.forEach(u => console.error(`  [${u.class}] ${u.path}`));
  console.error('\nCI cannot silently ignore these. Run tools/generate-byte-exact-manifest.js (extended to include the new path(s)) before proceeding.');
  process.exit(1);
}
console.log('\nManifest completeness check passed — every byte-exact-class file on disk is registered.');
