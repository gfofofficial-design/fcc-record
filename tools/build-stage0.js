#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.join(__dirname,'..'),out=path.join(root,'.fcc-local','stage0-build');
fs.mkdirSync(out,{recursive:true});
const files=['index.html','app.js','styles.css'];
const assets={};
for(const file of files){const bytes=fs.readFileSync(path.join(root,'site',file));fs.writeFileSync(path.join(out,file),bytes);assets[file]=crypto.createHash('sha256').update(bytes).digest('hex');}
const source=require('./lib/stage0-record').recordReader(root).projection();
fs.writeFileSync(path.join(out,'record-projection.json'),JSON.stringify(source,null,2));
fs.writeFileSync(path.join(out,'build-manifest.json'),JSON.stringify({source_commit:source.commit,assets,mode:'local-workbench',requires:'node tools/stage0-server.js',production_ready:false},null,2));
console.log('Stage 0 local application built: '+out);
console.log('Start with npm start. This build does not activate production services.');
