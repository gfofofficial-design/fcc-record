'use strict';
const fs = require('fs');
const path = require('path');
const { buildPlan } = require('./production-record');

// Validate saved observations against committed expectations. This is not a
// signature or a fresh network check: a local report remains local telemetry.
function assessReport(report, plan) {
  const invalid = { status: 'INVALID_REPORT', matches_current_commit: false };
  if (!report || typeof report !== 'object' || report.repository !== plan.repository ||
      !/^[a-f0-9]{40}$/.test(report.commit) || !Number.isFinite(Date.parse(report.observed_at))) return invalid;
  if (report.commit !== plan.commit) return { status: 'STALE', commit: report.commit, observed_at: report.observed_at, matches_current_commit: false };
  if (!Array.isArray(report.artifacts) || report.artifacts.length !== plan.artifacts.length || report.total !== plan.artifacts.length) return invalid;
  const expected = new Map(plan.artifacts.map(a => [a.path, a]));
  let matched = 0;
  for (const artifact of report.artifacts) {
    if (!artifact || typeof artifact !== 'object') return invalid;
    const target = expected.get(artifact.path);
    if (!target || artifact.expected_sha256 !== target.expected_sha256) return invalid;
    expected.delete(artifact.path);
    if (!['MATCH', 'MISMATCH', 'NOT_FOUND', 'HTTP_ERROR', 'UNAVAILABLE', 'TOO_LARGE'].includes(artifact.status)) return invalid;
    if (artifact.status === 'MATCH') {
      if (artifact.observed_sha256 !== target.expected_sha256 || artifact.bytes !== target.bytes) return invalid;
      matched++;
    }
  }
  const status = matched === plan.artifacts.length ? 'VERIFIED' : 'FAILED';
  if (report.matched !== matched || report.status !== status) return invalid;
  return { status, commit: report.commit, observed_at: report.observed_at, matched, total: plan.artifacts.length, matches_current_commit: true };
}

function readProductionReport(root) {
  let report;
  try { report = JSON.parse(fs.readFileSync(path.join(root, '.fcc-local', 'production-readback.json'), 'utf8')); }
  catch (error) { return { status: error.code === 'ENOENT' ? 'NOT_RUN' : 'INVALID_REPORT', matches_current_commit: false }; }
  try { return assessReport(report, buildPlan(root)); }
  catch { return { status: 'UNAVAILABLE', matches_current_commit: false }; }
}
module.exports = { assessReport, readProductionReport };
