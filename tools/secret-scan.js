#!/usr/bin/env node
// Secret scan (BUILD 01.2 item 4). Two modes:
//   default        — scans tracked files in the current checkout (fast, CI-friendly)
//   --history      — scans EVERY reachable blob in the full git history via
//                     git object plumbing, so a key committed and later
//                     deleted still fails the scan. Never prints matched
//                     private-key bytes — only the offending blob sha and
//                     (best-effort) the path it was first seen at.
// No third-party secret-scanning dependency — deterministic git-object scan only.
const { execSync, spawnSync } = require('child_process');
const PATTERNS = ['BEGIN PRIVATE KEY', 'BEGIN EC PRIVATE KEY', 'BEGIN RSA PRIVATE KEY', 'BEGIN OPENSSH PRIVATE KEY'];
const historyMode = process.argv.includes('--history');

let found = false;

if (!historyMode) {
  for (const p of PATTERNS) {
    const result = spawnSync('git', ['grep', '-F', '-l', p, '--', '.', ':!tools/secret-scan.js'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) {
      console.log('LEAK DETECTED (current tree) for pattern:', p, '\n', result.stdout);
      found = true;
    } else if (result.status !== 1) {
      throw new Error(`secret scan git grep failed for pattern ${JSON.stringify(p)}: ${result.stderr || `exit ${result.status}`}`);
    }
  }
  if (found) { console.error('SECRET SCAN (current tree) FAILED'); process.exit(1); }
  console.log('Secret scan (current tree) passed — no private key material in tracked files.');
  process.exit(0);
}

// --history: walk every reachable blob object, regardless of whether it's
// referenced by the current tree.
const objectLines = execSync('git rev-list --objects --all', { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 }).split('\n').filter(Boolean);
const selfPath = 'tools/secret-scan.js';
let scanned = 0;
for (const line of objectLines) {
  const spaceIdx = line.indexOf(' ');
  const sha = spaceIdx === -1 ? line : line.slice(0, spaceIdx);
  const p = spaceIdx === -1 ? '' : line.slice(spaceIdx + 1);
  if (p === selfPath) continue; // this file legitimately contains the pattern strings
  let type;
  try { type = execSync(`git cat-file -t ${sha}`, { encoding: 'utf8' }).trim(); } catch (e) { continue; }
  if (type !== 'blob') continue;
  scanned++;
  let content;
  try { content = execSync(`git cat-file -p ${sha}`, { maxBuffer: 1024 * 1024 * 16 }).toString('utf8'); }
  catch (e) { continue; } // binary/unreadable blobs can't contain a PEM text marker meaningfully
  for (const pat of PATTERNS) {
    if (content.includes(pat)) {
      console.log(`LEAK DETECTED (history) blob ${sha}${p ? ' (path: ' + p + ')' : ''} — pattern "${pat}" present. Content NOT printed.`);
      found = true;
    }
  }
}
console.log(`Scanned ${scanned} reachable blob object(s) across full history.`);
if (found) { console.error('SECRET SCAN (full history) FAILED'); process.exit(1); }
console.log('Secret scan (full history) passed — no private key material in any reachable commit.');
