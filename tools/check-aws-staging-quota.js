'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { validateConfig } = require('./run-aws-staging-preflight');

function checkQuota(config, requestId, caseId, template, run = execFileSync) {
  validateConfig(config);
  if (!/^[A-Za-z0-9-]{2,128}$/.test(requestId || '') || !/^[0-9]{10,20}$/.test(caseId || '')) throw Error('Exact quota request ID and support case ID required');
  const functions = Object.values(template.Resources || {}).filter(r => r.Type === 'AWS::Lambda::Function');
  if (!functions.length) throw Error('No Lambda reservations found');
  let reserved = 0;
  for (const f of functions) {
    const value = f.Properties?.ReservedConcurrentExecutions;
    if (!Number.isSafeInteger(value) || value < 1) throw Error('Unresolved Lambda reservation');
    reserved += value;
  }
  const read = args => JSON.parse(run('aws', [...args, '--region', config.region, '--output', 'json', '--no-cli-pager'], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
    env: { ...process.env, AWS_PAGER: '', AWS_EC2_METADATA_DISABLED: 'true' }
  }));
  const identity = read(['sts', 'get-caller-identity']);
  if (identity.Account !== config.expectedAccountId) throw Error('Wrong AWS account; no further checks performed');
  const request = read(['service-quotas', 'get-requested-service-quota-change', '--request-id', requestId]).RequestedQuota;
  const quotaArn = `arn:aws:servicequotas:${config.region}:${config.expectedAccountId}:lambda/L-B99A9384`;
  if (!request || request.Id !== requestId || request.CaseId !== caseId || request.ServiceCode !== 'lambda' ||
      request.QuotaCode !== 'L-B99A9384' || request.QuotaArn !== quotaArn || request.GlobalQuota !== false ||
      !Number.isSafeInteger(request.DesiredValue) || request.DesiredValue < 1) throw Error('Quota request scope or value does not match');
  const limits = read(['lambda', 'get-account-settings']).AccountLimit;
  if (!limits || !Number.isSafeInteger(limits.ConcurrentExecutions) || !Number.isSafeInteger(limits.UnreservedConcurrentExecutions) ||
      limits.UnreservedConcurrentExecutions < 0 || limits.ConcurrentExecutions < limits.UnreservedConcurrentExecutions) throw Error('Applied Lambda limits are missing or invalid');
  const reasons = [];
  if (request.Status !== 'APPROVED') reasons.push('Quota request is not APPROVED');
  if (limits.ConcurrentExecutions < request.DesiredValue) reasons.push('Requested concurrency has not been fully applied');
  // Conservative staging guard: preserve 100 unreserved units after both reservations.
  if (limits.UnreservedConcurrentExecutions < 100 + reserved) reasons.push('Insufficient unreserved headroom for a fresh deployment');
  return { status: reasons.length ? 'BLOCKED' : 'PASS', accountId: identity.Account, region: config.region,
    requestId, caseId, requestStatus: request.Status, desired: request.DesiredValue,
    applied: limits.ConcurrentExecutions, unreserved: limits.UnreservedConcurrentExecutions,
    newReservations: reserved, preservedUnreserved: 100, reasons, deploymentPerformed: false };
}
module.exports = { checkQuota };
if (require.main === module) {
  try {
    if (process.argv.length !== 5) throw Error('Usage: node tools/check-aws-staging-quota.js <preflight.json> <request-id> <case-id>');
    const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const template = JSON.parse(fs.readFileSync(path.join(__dirname, '../infrastructure/aws-staging-intake.template.json'), 'utf8'));
    const report = checkQuota(config, process.argv[3], process.argv[4], template);
    console.log(JSON.stringify(report, null, 2)); process.exitCode = report.status === 'PASS' ? 0 : 1;
  } catch (error) { console.error('QUOTA CHECK FAILED: ' + error.message); process.exitCode = 1; }
}
