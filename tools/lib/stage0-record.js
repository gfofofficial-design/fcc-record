'use strict';
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const DOCUMENTS = {
  doctrine: 'governance/frozen/FCC_CAPITAL_DOCTRINE_V0_1_1.md',
  specification: 'governance/frozen/FCC_CAPITAL_INSTRUMENT_SPEC_V0_1_1.md',
  blueprint: 'governance/frozen/FCC_PRODUCT_BLUEPRINT_V1_1_1.md',
  architecture: 'governance/frozen/FCC_STAGE0_IMPLEMENTATION_ARCHITECTURE_V0_1_2.md'
};
function recordReader(root) {
  const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  function projection() {
    const commit = git(['rev-parse','HEAD']).toString().trim();
    const files = git(['ls-tree','-r','--name-only',commit,'--','record']).toString().trim().split('\n').filter(Boolean);
    const artifacts = files.map(file => { const bytes = git(['show',`${commit}:${file}`]); return { path: file, sha256: sha(bytes), size: bytes.length }; });
    return { commit, label: 'Read-only projection of committed record bytes', instruments: files.filter(p => /^record\/instruments\/[^/]+\/locked.json$/.test(p)).map(p => ({ instrument_id: p.split('/')[2], path: p })), artifacts, limitations: ['Blob hashes establish byte identity, not truthful claims or Bitcoin precedence.', 'No record-writing endpoint is exposed.'] };
  }
  function document(key) { if(!DOCUMENTS[key]) throw new Error('Document not found'); const content = git(['show','HEAD:'+DOCUMENTS[key]]); return { path: DOCUMENTS[key], sha256: sha(content), text: content.toString('utf8') }; }
  function artifact(file) {
    const view = projection();
    if (!view.artifacts.some(a => a.path === file)) throw new Error('Record artifact not found');
    return { path: file, commit: view.commit, text: git(['show',view.commit+':'+file]).toString('utf8') };
  }
  return { projection, document, artifact };
}
module.exports = { recordReader, DOCUMENTS };
