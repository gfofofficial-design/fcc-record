// FCC STAGE 0 — DISCOVERY RESUME STORE (operational state only, NOT governance evidence).
//
// The only module in the discovery tooling that writes to disk, and it can write
// to exactly one place: `<repo>/.fcc-local/` (gitignored). Any other target path
// is refused. The resume file binds itself to public HEAD + rule constants +
// cutoff; a resume against different pins is refused. It never contains the
// TALLY_API_KEY, any Api-Key/authorization header, or request headers at all —
// only discovery progress (organization pages, governors, activity results).
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const LOCAL_DIR = '.fcc-local';
const FILE = 'a2-discovery-resume.json';
const FORBIDDEN_KEYS = /api-?key|authorization|tally_api_key|bearer|token/i;

function publicHead(repoRoot) {
  try { return execSync('git rev-parse HEAD', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { return null; }
}
function resumePath(repoRoot) { return path.join(repoRoot, LOCAL_DIR, FILE); }

function assertNoSecrets(obj) {
  const walk = (v, keyPath) => {
    if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) { if (FORBIDDEN_KEYS.test(k)) throw new Error(`resume state refused: forbidden key "${keyPath}.${k}"`); walk(x, `${keyPath}.${k}`); } }
    else if (typeof v === 'string' && /^Api-Key:/i.test(v)) throw new Error('resume state refused: header-like string');
  };
  walk(obj, '$');
}

function makePins({ repoRoot, N, ACTIVITY_DAYS, cutoff, ruleTag }) {
  return { publicHead: publicHead(repoRoot), N, ACTIVITY_DAYS, cutoff, ruleTag };
}

function save(repoRoot, pins, progress) {
  const target = resumePath(repoRoot);
  const rel = path.relative(repoRoot, target);
  if (!rel.startsWith(LOCAL_DIR + path.sep) && rel !== path.join(LOCAL_DIR, FILE)) throw new Error('resume store refused: target outside .fcc-local/');
  const state = { artifact_class: 'DISCOVERY_RESUME_STATE_LOCAL_ONLY', not_governance_evidence: true, pins, progress, saved_at: new Date().toISOString() };
  assertNoSecrets(state);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(state, null, 2) + '\n');
  return target;
}

function load(repoRoot, pins) {
  const target = resumePath(repoRoot);
  if (!fs.existsSync(target)) return { found: false };
  let state; try { state = JSON.parse(fs.readFileSync(target, 'utf8')); } catch (e) { return { found: true, ok: false, reason: 'unreadable resume file' }; }
  const mismatches = Object.keys(pins).filter((k) => JSON.stringify(state.pins && state.pins[k]) !== JSON.stringify(pins[k]));
  if (mismatches.length) return { found: true, ok: false, reason: `resume refused — pins differ: ${mismatches.join(', ')}` };
  return { found: true, ok: true, progress: state.progress };
}

function clear(repoRoot) { const t = resumePath(repoRoot); if (fs.existsSync(t)) fs.unlinkSync(t); }

module.exports = { save, load, clear, makePins, resumePath, assertNoSecrets, LOCAL_DIR };
