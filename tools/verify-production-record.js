#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {buildPlan,verifyProductionRecord}=require('./lib/production-record');
const root=path.join(__dirname,'..'),directory=path.join(root,'.fcc-local');
async function main() {
  if(process.argv.length>3)throw Error('Usage: node tools/verify-production-record.js [full-commit-sha]');
  return verifyProductionRecord(buildPlan(root,process.argv[2]));
}
main().catch(e=>({status:'ERROR',observed_at:new Date().toISOString(),error:e.message,commit:process.argv[2]||null})).then(report=>{
  fs.mkdirSync(directory,{recursive:true});
  const target=path.join(directory,'production-readback.json'),temp=target+'.'+crypto.randomUUID()+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(report,null,2)); fs.renameSync(temp,target);
  console.log(JSON.stringify(report,null,2)); process.exitCode=report.status==='VERIFIED'?0:1;
});
