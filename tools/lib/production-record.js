'use strict';
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const REPOSITORY = 'gfofofficial-design/fcc-record';
const MANIFEST = 'governance/evidence/byte-exact-manifest.json';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function validPath(value) {
  return typeof value === 'string' && /^(record|governance)\/[A-Za-z0-9_./-]+$/.test(value) && !value.split('/').some(p => p === '.' || p === '..' || !p);
}
function buildPlan(root, commit) {
  const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  commit = commit || git(['rev-parse','HEAD']).toString().trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('A full immutable commit SHA is required');
  if (git(['rev-parse',commit+'^{commit}']).toString().trim() !== commit) throw new Error('Commit is not available locally');
  const manifest = JSON.parse(git(['show',commit+':'+MANIFEST]).toString('utf8'));
  if (!Array.isArray(manifest.entries) || !manifest.entries.length) throw new Error('Byte-exact manifest is empty or invalid');
  const pinned = new Map();
  for (const entry of manifest.entries) {
    if (!validPath(entry.path) || !/^[a-f0-9]{64}$/.test(entry.content_sha256) || pinned.has(entry.path)) throw new Error('Invalid or duplicate manifest entry');
    pinned.set(entry.path,entry.content_sha256);
  }
  const recordFiles = git(['ls-tree','-r','--name-only',commit,'--','record']).toString().trim().split('\n').filter(Boolean);
  const paths = [...new Set([MANIFEST,...pinned.keys(),...recordFiles])].sort();
  const artifacts = paths.map(file => {
    if (!validPath(file)) throw new Error('Unsupported artifact path');
    const bytes = git(['show',commit+':'+file]); const hash = sha256(bytes);
    if (pinned.has(file) && pinned.get(file) !== hash) throw new Error('Committed bytes differ from manifest: '+file);
    return { path:file, expected_sha256:hash, bytes:bytes.length, manifest_pinned:pinned.has(file) };
  });
  return { repository:REPOSITORY, commit, artifacts };
}
function validatePlan(plan) {
  if (plan.repository !== REPOSITORY || !/^[a-f0-9]{40}$/.test(plan.commit) || !Array.isArray(plan.artifacts) || !plan.artifacts.length) throw new Error('Invalid production verification plan');
  const seen = new Set();
  for (const a of plan.artifacts) {
    if (!validPath(a.path) || !/^[a-f0-9]{64}$/.test(a.expected_sha256) || seen.has(a.path)) throw new Error('Invalid verification artifact');
    seen.add(a.path);
  }
}
async function verifyProductionRecord(plan, { fetchImpl = fetch, timeoutMs = 15000, maxBytes = 32 * 1024 * 1024, now = () => new Date().toISOString() } = {}) {
  validatePlan(plan);
  async function verify(a) {
    const url = 'https://raw.githubusercontent.com/'+REPOSITORY+'/'+plan.commit+'/'+a.path.split('/').map(encodeURIComponent).join('/');
    const controller = new AbortController(); const timeout = setTimeout(()=>controller.abort(),timeoutMs);
    const base = { path:a.path, expected_sha256:a.expected_sha256, url };
    try {
      const response = await fetchImpl(url,{ method:'GET', credentials:'omit', redirect:'error', cache:'no-store', headers:{Accept:'application/octet-stream'}, signal:controller.signal });
      if (!response.ok) { await response.body?.cancel(); return {...base,status:response.status===404?'NOT_FOUND':'HTTP_ERROR',http_status:response.status}; }
      if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); return {...base,status:'TOO_LARGE'}; }
      let length = 0; const digest = crypto.createHash('sha256');
      if (!response.body) throw new Error('Missing response stream');
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > maxBytes) { controller.abort(); return {...base,status:'TOO_LARGE'}; }
        digest.update(chunk);
      }
      const actual = digest.digest('hex');
      return {...base,status:actual===a.expected_sha256?'MATCH':'MISMATCH',observed_sha256:actual,bytes:length};
    } catch { return {...base,status:'UNAVAILABLE',reason:controller.signal.aborted?'Request timed out or was aborted':'Anonymous fetch failed; no publication claim can be made'}; }
    finally { clearTimeout(timeout); }
  }
  const results=[];
  // Bound concurrency and response size; no token, cookie, POST, or redirect path.
  for(let i=0;i<plan.artifacts.length;i+=4) results.push(...await Promise.all(plan.artifacts.slice(i,i+4).map(verify)));
  return { repository:REPOSITORY,commit:plan.commit,observed_at:now(),status:results.every(a=>a.status==='MATCH')?'VERIFIED':'FAILED',scope:'Anonymous readback of committed record artifacts and byte-exact manifest entries',matched:results.filter(a=>a.status==='MATCH').length,total:results.length,artifacts:results,limitations:['Observation time is a local clock claim, not independently proven publication time.','Matching bytes do not verify source truth, Bitcoin anchors, identity ownership, or permission to execute.','This read-only check does not authorize or perform production publication.'] };
}
module.exports = { REPOSITORY, buildPlan, verifyProductionRecord };
