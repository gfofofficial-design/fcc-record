// FCC Stage 0 — Epoch 2 C1-C3 readiness/provenance transaction.
// This is the only spawning layer in the rerun stack. It invokes only git and
// the readiness-only verifier; it never invokes acquisition or candidate intake.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const READINESS_SOURCE = 'tools/verify-acquisition-readiness.js';
const PROBE_KIND = 'EPOCH2_RERUN_READINESS_TRANSACTION_RESULT';
const FRESHNESS_MS = 10 * 60 * 1000;
const EXECUTION_CRITICAL_FILES = Object.freeze([
  READINESS_SOURCE,
  'tools/lib/acquisition-adapters.js',
  'tools/lib/live-acquisition-provider.js',
  'tools/lib/epoch2-selection.js',
  'governance/schemas/v2/epoch2-shortage-event.schema.json',
  'governance/schemas/v2/candidate-slate.v2.rerun-selected.schema.json',
  'tools/lib/epoch2-rerun-completion.js',
  'tools/lib/epoch2-shortage-result.js',
  'tools/lib/epoch2-rerun-selected-result.js',
  'tools/lib/epoch2-rerun-authorization.js',
  'tools/lib/epoch2-rerun-readiness-probe.js',
  'tools/run-epoch2-rerun-intake.js',
  'tools/ci-epoch2-rerun-guard.js',
]);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const utcSec = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

const realSys = {
  git: (repoRoot, args) => { const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' }); return { status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') }; },
  runVerifier: (repoRoot) => { const r = spawnSync(process.execPath, [path.join(repoRoot, READINESS_SOURCE)], { cwd: repoRoot, encoding: 'utf8', env: process.env }); return { status: r.status, stdout: String(r.stdout || '') }; },
  readFile: (repoRoot, rel) => { try { return fs.readFileSync(path.join(repoRoot, rel)); } catch (e) { return null; } },
  now: () => new Date(),
};

function currentHeadWith(sys, repoRoot) {
  const r = sys.git(repoRoot, ['rev-parse', 'HEAD']);
  const head = r.stdout.trim();
  return r.status === 0 && /^[0-9a-f]{40}$/.test(head) ? head : null;
}

function treeStateWith(sys, repoRoot) {
  const r = sys.git(repoRoot, ['status', '--porcelain', '--untracked-files=all']);
  if (r.status !== 0) return { clean: false, lines: ['git status failed'] };
  const lines = r.stdout.split('\n').filter((line) => line.trim().length);
  return { clean: lines.length === 0, lines };
}

function criticalFilesVerifiedWith(sys, repoRoot, head) {
  const problems = [], hashes = {};
  for (const rel of EXECUTION_CRITICAL_FILES) {
    const disk = sys.readFile(repoRoot, rel);
    const blob = sys.git(repoRoot, ['show', `${head}:${rel}`]);
    hashes[rel] = disk ? sha256(disk) : null;
    if (!disk) { problems.push(rel + ': missing on disk'); continue; }
    if (blob.status !== 0) { problems.push(rel + ': not in HEAD'); continue; }
    if (sha256(disk) !== sha256(Buffer.from(blob.stdout, 'utf8'))) problems.push(rel + ': working-tree bytes differ from HEAD blob');
  }
  return { verified: problems.length === 0, problems, hashes };
}

function verifyPinnedCommitWith(sys, repoRoot, publicCommit, pins) {
  const problems = [];
  if (!/^[0-9a-f]{40}$/.test(publicCommit || '')) return { valid: false, problems: ['public infrastructure commit is not full 40-hex'] };
  const ancestor = sys.git(repoRoot, ['merge-base', '--is-ancestor', publicCommit, 'HEAD']);
  if (ancestor.status !== 0) problems.push('public infrastructure commit is not an ancestor of current HEAD');
  for (const [rel, expected] of Object.entries(pins || {})) {
    if (!EXECUTION_CRITICAL_FILES.includes(rel)) { problems.push(rel + ': not a recognized execution-critical path'); continue; }
    if (!/^[0-9a-f]{64}$/.test(expected || '')) { problems.push(rel + ': invalid sha256 pin'); continue; }
    const blob = sys.git(repoRoot, ['show', `${publicCommit}:${rel}`]);
    if (blob.status !== 0) { problems.push(rel + ': absent from public infrastructure commit'); continue; }
    if (sha256(Buffer.from(blob.stdout, 'utf8')) !== expected) problems.push(rel + ': public-commit blob differs from authorization pin');
  }
  return { valid: problems.length === 0, problems };
}

function runReadinessTransactionWith(sys, repoRoot) {
  const started = sys.now();
  const pre = treeStateWith(sys, repoRoot);
  const headBefore = currentHeadWith(sys, repoRoot);
  const files = headBefore ? criticalFilesVerifiedWith(sys, repoRoot, headBefore) : { verified: false, problems: ['HEAD unknown'], hashes: {} };
  let run = { status: null, stdout: '' };
  if (pre.clean && headBefore && files.verified) run = sys.runVerifier(repoRoot);
  const headAfter = currentHeadWith(sys, repoRoot);
  const post = treeStateWith(sys, repoRoot);
  const completed = sys.now();
  const aggregate = /AGGREGATE INTAKE_READINESS: (READY|BLOCKED)/.exec(run.stdout);
  return {
    kind: PROBE_KIND,
    source: READINESS_SOURCE,
    tree_clean_before: pre.clean,
    tree_clean_after: post.clean,
    tree_problems: pre.lines.concat(post.lines).slice(0, 20),
    head_before: headBefore,
    head_after: headAfter,
    critical_files_verified: files.verified,
    critical_file_problems: files.problems,
    critical_file_hashes: files.hashes,
    exit_status: run.status,
    aggregate: run.status === 0 && aggregate ? aggregate[1] : null,
    started_at: utcSec(started),
    completed_at: utcSec(completed),
    output_sha256: sha256(Buffer.from(run.stdout, 'utf8')),
    output_bytes: Buffer.byteLength(run.stdout),
  };
}

function validateReadinessProvenance(result, { nowMs, headSha }) {
  const problems = [];
  if (!result || typeof result !== 'object') return { valid: false, aggregate: null, problems: ['no probe result'] };
  if (result.kind !== PROBE_KIND || result.source !== READINESS_SOURCE) problems.push('not a machine rerun-readiness result');
  if (result.tree_clean_before !== true || result.tree_clean_after !== true) problems.push('working tree/index not clean throughout probe');
  if (result.critical_files_verified !== true) problems.push('execution-critical files do not equal HEAD blobs');
  if (!/^[0-9a-f]{40}$/.test(result.head_before || '') || result.head_before !== result.head_after) problems.push('HEAD changed or was unknown during probe');
  if (result.exit_status !== 0) problems.push('readiness tool did not exit 0');
  if (!['READY', 'BLOCKED'].includes(result.aggregate)) problems.push('no parsed aggregate');
  if (!/^[0-9a-f]{64}$/.test(result.output_sha256 || '') || !Number.isInteger(result.output_bytes) || result.output_bytes <= 0) problems.push('output hash/bytes missing');
  const real = (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s || '') && !Number.isNaN(Date.parse(s)) && utcSec(new Date(Date.parse(s))) === s;
  if (!real(result.started_at) || !real(result.completed_at)) problems.push('probe timestamps not real full-UTC instants');
  else {
    const completed = Date.parse(result.completed_at);
    if (Date.parse(result.started_at) > completed) problems.push('probe completed before it started');
    if (completed > nowMs + 5000) problems.push('completed_at is in the future');
    if (nowMs - completed > FRESHNESS_MS) problems.push('probe result stale');
  }
  if (!/^[0-9a-f]{40}$/.test(headSha || '') || result.head_after !== headSha) problems.push('probe does not bind the current repository HEAD');
  return { valid: problems.length === 0, aggregate: problems.length ? null : result.aggregate, problems };
}

const runReadinessProbe = (repoRoot) => runReadinessTransactionWith(realSys, repoRoot);
const currentHead = (repoRoot) => currentHeadWith(realSys, repoRoot);
const verifyPinnedCommit = (repoRoot, publicCommit, pins) => verifyPinnedCommitWith(realSys, repoRoot, publicCommit, pins);

module.exports = { READINESS_SOURCE, PROBE_KIND, FRESHNESS_MS, EXECUTION_CRITICAL_FILES, currentHead, runReadinessProbe, validateReadinessProvenance, verifyPinnedCommit,
  __testOnly: { test_only: true, runReadinessTransactionWith, currentHeadWith, treeStateWith, criticalFilesVerifiedWith, verifyPinnedCommitWith } };
