#!/usr/bin/env node
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createWorkspace, verifyReceipt } = require('./lib/stage0-workspace');
const { recordReader } = require('./lib/stage0-record');
const domain = require('./lib/stage0-domain');
const { readProductionReport } = require('./lib/production-report');
function createServer({ root = path.join(__dirname,'..'), workspace = path.join(root,'.fcc-local','stage0'), port = 4173 } = {}) {
  const store = createWorkspace(workspace); const records = recordReader(root);
  const assets = { '/': ['index.html','text/html'], '/app.js': ['app.js','text/javascript'], '/styles.css': ['styles.css','text/css'] };
  function send(res,status,data,type='application/json') { res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'}); res.end(type === 'application/json' ? JSON.stringify(data) : data); }
  const server = http.createServer(async(req,res) => {
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
    const actualPort = server.address().port;
    if(!['127.0.0.1:'+actualPort,'localhost:'+actualPort].includes(req.headers.host)) return send(res,403,{error:'Local host required'});
    const origin = req.headers.origin;
    if(origin && !['http://127.0.0.1:'+actualPort,'http://localhost:'+actualPort].includes(origin)) return send(res,403,{error:'Same-origin requests required'});
    try {
      const url = new URL(req.url,'http://localhost');
      if(req.method === 'GET') {
        if(assets[url.pathname]) { const [file,type] = assets[url.pathname]; return send(res,200,fs.readFileSync(path.join(root,'site',file)),type); }
        if(url.pathname === '/api/state') return send(res,200,store.publicState());
        if(url.pathname === '/api/record') return send(res,200,records.projection());
        if(url.pathname === '/api/production-readback') {
          return send(res,200,readProductionReport(root));
        }
        if(url.pathname === '/api/document') return send(res,200,records.document(url.searchParams.get('key')));
        if(url.pathname === '/api/artifact') return send(res,200,records.artifact(url.searchParams.get('path')));
        return send(res,404,{error:'Not found'});
      }
      if(req.method !== 'POST') return send(res,405,{error:'Method not allowed'});
      if(!origin || req.headers['content-type'] !== 'application/json') return send(res,403,{error:'JSON and same-origin header required'});
      let chunks=[],length=0;
      for await (const chunk of req) { length+=chunk.length; if(length>65536) { send(res,413,{error:'Request exceeds 64 KiB'}); return; } chunks.push(chunk); }
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!input || typeof input !== 'object' || Array.isArray(input)) throw Error('JSON object required');
      if(url.pathname === '/api/fixtures') return send(res,201,store.loadAcceptance());
      if(url.pathname === '/api/fixture') return send(res,201,store.createOpen(input.id));
      if(url.pathname === '/api/challenge') return send(res,201,store.submitChallenge(input.id,input.submission));
      if(url.pathname === '/api/respond') return send(res,200,store.respond(input.id,input.challenge_id,input.response));
      if(url.pathname === '/api/resolve') return send(res,200,store.resolve(input.id,input.resolution));
      if(url.pathname === '/api/verify') {
        const item=store.publicState().instruments.find(i => i.instrument_id === input.id);
        if(!item) throw Error('Fixture not found'); return send(res,200,domain.verifyFixture(item));
      }
      if(url.pathname === '/api/verify-receipt') return send(res,200,{valid:verifyReceipt(input.receipt,store.publicState().receipt_public_key),fixture_only:true});
      return send(res,404,{error:'Not found'});
    } catch(e) { send(res,400,{error:e.message}); }
  });
  return server;
}
if(require.main === module) { const server=createServer(); server.listen(4173,'127.0.0.1',()=>console.log('FCC Stage 0 workbench: http://127.0.0.1:4173 (local fixture workspace; no production writes)')); }
module.exports = { createServer };
