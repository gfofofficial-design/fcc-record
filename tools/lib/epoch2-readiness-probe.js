// FCC STAGE 0 — EPOCH 2 READINESS TRANSACTION (production provenance layer, REV5 / R5-5).
//
// The ONLY spawning code in the Epoch 2 gate stack. It spawns exactly two kinds of
// process: `git` (status / rev-parse / show, for tree cleanliness, HEAD binding and
// HEAD-blob byte verification) and tools/verify-acquisition-readiness.js
// (READINESS_PROBE_ONLY — never intake, never discovery). Every value in the result
// is derived here; nothing supplied by a caller enters it.
//
// Transaction: tree+index clean and no relevant untracked files -> HEAD_before ->
// every execution-critical tooling file's disk bytes == its HEAD blob -> run the
// verifier -> HEAD_after == HEAD_before -> tree still clean -> completed_at (post-probe).
// Provenance is validated AFTER the probe against HEAD and time re-read then.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const READINESS_SOURCE = 'tools/verify-acquisition-readiness.js';
const PROBE_KIND = 'EPOCH2_READINESS_TRANSACTION_RESULT';
const FRESHNESS_MS = 10 * 60 * 1000;
// Bytes that must equal their HEAD blobs for a readiness result to have any meaning.
const EXECUTION_CRITICAL_TOOLING = [
  READINESS_SOURCE,
  'tools/lib/intake-cutoff.js',
  'tools/lib/intake-authorization.js',
  'tools/lib/epoch2-intake-authorization.js',
  'tools/lib/epoch2-readiness-probe.js',
  'tools/lib/intake-final-write.js',
  'tools/ci-intake-guard.js',
];
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const utcSec = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

// Real system adapter (production). Only 'git' and the readiness verifier are ever run.
const realSys = {
  git: (repoRoot, args) => { const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' }); return { status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') }; },
  runVerifier: (repoRoot) => { const r = spawnSync(process.execPath, [path.join(repoRoot, READINESS_SOURCE)], { cwd: repoRoot, encoding: 'utf8', env: process.env }); return { status: r.status, stdout: String(r.stdout || '') }; },
  readFile: (repoRoot, rel) => { try { return fs.readFileSync(path.join(repoRoot, rel)); } catch (e) { return null; } },
  now: () => new Date(),
};

function currentHeadWith(sys, repoRoot) {
  const r = sys.git(repoRoot, ['rev-parse', 'HEAD']); const h = r.stdout.trim();
  return r.status === 0 && /^[0-9a-f]{40}$/.test(h) ? h : null;
}
function treeStateWith(sys, repoRoot) {
  const r = sys.git(repoRoot, ['status', '--porcelain', '--untracked-files=all']);
  if (r.status !== 0) return { clean: false, lines: ['git status failed'] };
  const lines = r.stdout.split('\n').filter((l) => l.trim().length);
  return { clean: lines.length === 0, lines };
}
function toolingVerifiedWith(sys, repoRoot, head) {
  const problems = [];
  for (const rel of EXECUTION_CRITICAL_TOOLING) {
    const disk = sys.readFile(repoRoot, rel);
    const blob = sys.git(repoRoot, ['show', `${head}:${rel}`]);
    if (!disk) { problems.push(rel + ': missing on disk'); continue; }
    if (blob.status !== 0) { problems.push(rel + ': not in HEAD'); continue; }
    if (sha256(disk) !== sha256(Buffer.from(blob.stdout, 'utf8'))) problems.push(rel + ': working-tree bytes differ from HEAD blob');
  }
  return { verified: problems.length === 0, problems, hashes: Object.fromEntries(EXECUTION_CRITICAL_TOOLING.map((rel) => { const b = sys.readFile(repoRoot, rel); return [rel, b ? sha256(b) : null]; })) };
}

function runReadinessTransactionWith(sys, repoRoot) {
  const started = sys.now();
  const pre = treeStateWith(sys, repoRoot);
  const headBefore = currentHeadWith(sys, repoRoot);
  const tooling = headBefore ? toolingVerifiedWith(sys, repoRoot, headBefore) : { verified: false, problems: ['HEAD unknown'], hashes: {} };
  let run = { status: null, stdout: '' };
  if (pre.clean && headBefore && tooling.verified) run = sys.runVerifier(repoRoot); // never run the verifier on an unclean/unverified tree
  const headAfter = currentHeadWith(sys, repoRoot);
  const post = treeStateWith(sys, repoRoot);
  const completed = sys.now();
  const m = /AGGREGATE INTAKE_READINESS: (READY|BLOCKED)/.exec(run.stdout);
  return {
    kind: PROBE_KIND, source: READINESS_SOURCE,
    tree_clean_before: pre.clean, tree_clean_after: post.clean, tree_problems: pre.lines.concat(post.lines).slice(0, 10),
    head_before: headBefore, head_after: headAfter,
    tooling_verified: tooling.verified, tooling_problems: tooling.problems, tooling_hashes: tooling.hashes,
    exit_status: run.status,
    aggregate: run.status === 0 && m ? m[1] : null,
    started_at: utcSec(started), completed_at: utcSec(completed),
    output_sha256: sha256(Buffer.from(run.stdout, 'utf8')), output_bytes: Buffer.byteLength(run.stdout),
  };
}
const runReadinessProbe = (repoRoot) => runReadinessTransactionWith(realSys, repoRoot);
const currentHead = (repoRoot) => currentHeadWith(realSys, repoRoot);

// Pure. Validate AFTER the probe, with HEAD and time re-read after it.
function validateReadinessProvenance(result, { nowMs, headSha }) {
  const p = [];
  if (!result || typeof result !== 'object') return { valid: false, aggregate: null, problems: ['no probe result'] };
  if (result.kind !== PROBE_KIND || result.source !== READINESS_SOURCE) p.push('not a machine readiness-transaction result');
  if (result.tree_clean_before !== true) p.push('working tree/index not clean before probe');
  if (result.tree_clean_after !== true) p.push('working tree/index not clean after probe');
  if (result.tooling_verified !== true) p.push('execution-critical tooling bytes do not equal HEAD blobs');
  if (!/^[0-9a-f]{40}$/.test(result.head_before || '') || result.head_before !== result.head_after) p.push('HEAD changed or unknown during probe');
  if (result.exit_status !== 0) p.push('readiness tool did not exit 0');
  if (result.aggregate !== 'READY' && result.aggregate !== 'BLOCKED') p.push('no parsed aggregate');
  if (!/^[0-9a-f]{64}$/.test(result.output_sha256 || '') || typeof result.output_bytes !== 'number' || result.output_bytes <= 0) p.push('output hash/bytes missing');
  const real = (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s || '') && !Number.isNaN(Date.parse(s)) && utcSec(new Date(Date.parse(s))) === s;
  if (!real(result.started_at) || !real(result.completed_at)) p.push('probe timestamps not real full-UTC instants');
  else {
    const c = Date.parse(result.completed_at);
    if (Date.parse(result.started_at) > c) p.push('probe completed before it started');
    if (c > nowMs + 5000) p.push('completed_at is in the future');
    if (nowMs - c > FRESHNESS_MS) p.push('probe result stale (older than ' + FRESHNESS_MS / 60000 + ' min, measured from completion)');
  }
  if (!/^[0-9a-f]{40}$/.test(headSha || '')) p.push('current HEAD unknown');
  else if (result.head_after !== headSha) p.push('probe bound to a different HEAD than the current repository');
  return { valid: p.length === 0, aggregate: p.length === 0 ? result.aggregate : null, problems: p };
}

module.exports = { READINESS_SOURCE, PROBE_KIND, FRESHNESS_MS, EXECUTION_CRITICAL_TOOLING, currentHead, runReadinessProbe, validateReadinessProvenance,
  __testOnly: { runReadinessTransactionWith, currentHeadWith, treeStateWith, toolingVerifiedWith, test_only: true } };
