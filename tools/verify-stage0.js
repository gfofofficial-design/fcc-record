#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const file=path.join(root,'.fcc-local','stage0','workspace.json');
const { verifyFixture, aggregates }=require('./lib/stage0-domain');
const { verifyReceipt }=require('./lib/stage0-workspace');
if(!fs.existsSync(file)){console.error('No local fixture workspace. Start the app and create or load fixtures first.');process.exit(1);}
const data=JSON.parse(fs.readFileSync(file,'utf8'));
const instruments=data.instruments.map(i=>({instrument_id:i.instrument_id,...verifyFixture(i)}));
const receipts=data.receipts.map(r=>({receipt_id:r.receipt.provisional_receipt_id,valid:verifyReceipt(r.receipt,data.test_keys?.public)}));
const result={mode:'fixture-only',instruments,receipts,aggregates:aggregates(data.instruments,data.filings),limitations:['No Bitcoin proof verification','No production identity authentication','No source-truth verification']};
console.log(JSON.stringify(result,null,2));
process.exit(instruments.some(i=>!i.valid)||receipts.some(r=>!r.valid)?1:0);
