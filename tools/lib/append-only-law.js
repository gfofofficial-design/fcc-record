// FCC repository-level append-only law (frozen architecture v0.1.2 §19).
// Two distinct rules, not one blanket "no modification":
//
//   IMMUTABLE (write-once): locked.json files, annex files, .ots proof
//   files, frozen governance documents, and EXISTING versioned public keys.
//   These may never be modified or deleted. New ones may be ADDED.
//
//   APPEND-ONLY NDJSON: existing *.ndjson files may only grow by appending
//   complete new lines. Old bytes must remain an exact, untouched prefix
//   of the new bytes — no rewrite, no insertion, no reordering, no
//   truncation, no deletion of the file itself.
//
// This module is the single source of truth for both the adversarial test
// battery and the CI enforcement script (item 3), so the two can never
// silently diverge.
const { execSync } = require('child_process');

function isNdjson(path) { return /\.ndjson$/.test(path); }
function isProtectedRoot(path) {
  return /^record\//.test(path) || /^governance\/frozen\//.test(path) || /^governance\/keys\//.test(path);
}

function blobBytes(ref, path) {
  return execSync(`git cat-file blob ${ref}:${path}`, { maxBuffer: 1024 * 1024 * 64 });
}

// Verifies that `newBytes` is `oldBytes` plus one or more complete,
// newline-terminated JSON lines appended at the end — nothing else.
function verifyNdjsonAppend(oldBytes, newBytes) {
  if (newBytes.length < oldBytes.length) return { ok: false, reason: 'truncated (new file shorter than old)' };
  const prefix = newBytes.slice(0, oldBytes.length);
  if (!prefix.equals(oldBytes)) return { ok: false, reason: 'old bytes are not an exact untouched prefix (rewrite, insertion, or reorder)' };
  if (oldBytes.length > 0) {
    const lastByte = oldBytes[oldBytes.length - 1];
    if (lastByte !== 0x0a) return { ok: false, reason: 'existing file does not end in a newline — append boundary is not clean' };
  }
  const appended = newBytes.slice(oldBytes.length);
  if (appended.length === 0) return { ok: true, reason: 'no change' };
  const text = appended.toString('utf8');
  if (!text.endsWith('\n')) return { ok: false, reason: 'appended content does not end in a newline (incomplete final line)' };
  const lines = text.split('\n').filter((l, i, arr) => !(i === arr.length - 1 && l === ''));
  for (const line of lines) {
    try { JSON.parse(line); } catch (e) { return { ok: false, reason: `appended line is not valid JSON: ${e.message}` }; }
  }
  return { ok: true, reason: `${lines.length} complete JSON line(s) appended` };
}

// Returns an array of violation strings. Empty array = compliant.
function checkAppendOnlyLaw(baseRef, headRef) {
  const diff = execSync(`git diff --name-status ${baseRef} ${headRef} || true`, { encoding: 'utf8' });
  const violations = [];
  diff.split('\n').filter(Boolean).forEach(line => {
    const [status, path] = line.split(/\s+/);
    if (!isProtectedRoot(path)) return;

    if (status === 'A') return; // additions always allowed

    if (status === 'D') {
      violations.push(`DELETE ${path} — deletion of an existing protected artifact is prohibited`);
      return;
    }

    // status === 'M' (or similar) — modification
    if (isNdjson(path)) {
      const oldBytes = blobBytes(baseRef, path);
      const newBytes = blobBytes(headRef, path);
      const result = verifyNdjsonAppend(oldBytes, newBytes);
      if (!result.ok) violations.push(`MODIFY ${path} (ndjson) — REJECTED: ${result.reason}`);
      // else: legitimate append, not a violation
    } else {
      violations.push(`MODIFY ${path} — immutable artifact, modification prohibited`);
    }
  });
  return violations;
}

module.exports = { checkAppendOnlyLaw, verifyNdjsonAppend, isNdjson, isProtectedRoot, blobBytes };
