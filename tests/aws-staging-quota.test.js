'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { checkQuota } = require('../tools/check-aws-staging-quota');
const template = require('../infrastructure/aws-staging-intake.template.json');
const config = {schemaVersion:1, environment:'staging', expectedAccountId:'123456789012',region:'us-east-2',
  deploymentBucket:'fcc-test-bundle',budgetAlertEmail:'test@fcc.test',monthlyBudgetUsd:25,ownerTag:'FCC',sourceCommit:'a'.repeat(40)};
function fixture() {
  const request={Id:'request-test',CaseId:'123456789012345',ServiceCode:'lambda',QuotaCode:'L-B99A9384',
    QuotaArn:'arn:aws:servicequotas:us-east-2:123456789012:lambda/L-B99A9384',GlobalQuota:false,DesiredValue:1001,Status:'APPROVED'};
  const limits={ConcurrentExecutions:1001,UnreservedConcurrentExecutions:1001};
  const calls=[];
  const run=(command,args)=>{
    assert.equal(command,'aws');calls.push(args.slice(0,2));
    assert.equal(args[args.indexOf('--region')+1],'us-east-2');
    const name=args.slice(0,2).join(' ');
    if(name==='sts get-caller-identity')return JSON.stringify({Account:config.expectedAccountId});
    if(name==='service-quotas get-requested-service-quota-change')return JSON.stringify({RequestedQuota:request});
    if(name==='lambda get-account-settings')return JSON.stringify({AccountLimit:limits});
    throw Error('Mutation or unknown command attempted');
  };
  return {request,limits,calls,run,check:()=>checkQuota(config,request.Id,'123456789012345',template,run)};
}
test('approved and applied quota passes with only three read-only commands',()=>{
  const h=fixture();assert.equal(h.check().status,'PASS');assert.equal(h.calls.length,3);assert.equal(h.check().newReservations,3);
});
test('case open, approved but unapplied, and exhausted headroom all block',()=>{
  for(const mutate of [h=>h.request.Status='CASE_OPENED',h=>h.limits.ConcurrentExecutions=h.limits.UnreservedConcurrentExecutions=10,h=>h.limits.UnreservedConcurrentExecutions=102]){
    const h=fixture();mutate(h);assert.equal(h.check().status,'BLOCKED');
  }
  const h=fixture();h.limits.UnreservedConcurrentExecutions=103;assert.equal(h.check().status,'PASS');
});
test('scope mismatch, absent limits and invalid reservations fail closed',()=>{
  for(const mutate of [h=>h.request.CaseId='999999999999',h=>h.request.QuotaArn=h.request.QuotaArn.replace('us-east-2','us-east-1'),h=>h.request.ServiceCode='ec2',h=>h.request.DesiredValue=null,h=>delete h.limits.UnreservedConcurrentExecutions]){
    const h=fixture();mutate(h);assert.throws(h.check);
  }
  assert.throws(()=>checkQuota(config,'request-test','123456789012345',{Resources:{}},fixture().run));
});
test('wrong account and AWS errors never produce PASS',()=>{
  let count=0;assert.throws(()=>checkQuota(config,'request-test','123456789012345',template,()=>{count++;return '{"Account":"999999999999"}';}));assert.equal(count,1);
  assert.throws(()=>checkQuota(config,'request-test','123456789012345',template,()=>{throw Error('AccessDenied');}));
});
