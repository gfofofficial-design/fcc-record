'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REQUIRED_KEYS = new Set([
  'schemaVersion', 'environment', 'expectedAccountId', 'region',
  'deploymentBucket', 'budgetAlertEmail', 'monthlyBudgetUsd',
  'ownerTag', 'sourceCommit'
]);

function fail(message) { throw new Error(message); }
function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }

function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('configuration must be a JSON object');
  const keys = Object.keys(config);
  const missing = [...REQUIRED_KEYS].filter(key => !Object.hasOwn(config, key));
  const unknown = keys.filter(key => !REQUIRED_KEYS.has(key));
  if (missing.length) fail(`missing configuration keys: ${missing.join(', ')}`);
  if (unknown.length) fail(`unknown configuration keys: ${unknown.join(', ')}`);
  if (config.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (config.environment !== 'staging') fail('environment must be staging');
  if (!/^[0-9]{12}$/.test(config.expectedAccountId) || config.expectedAccountId === '000000000000') fail('expectedAccountId must be a real 12-digit account ID');
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-[0-9]$/.test(config.region) || config.region.includes('-gov-')) {
    fail('region must be a commercial AWS region');
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.deploymentBucket)) fail('deploymentBucket is invalid');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(config.budgetAlertEmail) || config.budgetAlertEmail.endsWith('@example.com')) {
    fail('budgetAlertEmail must be a real alert address');
  }
  if (!Number.isInteger(config.monthlyBudgetUsd) || config.monthlyBudgetUsd < 5 || config.monthlyBudgetUsd > 250) {
    fail('monthlyBudgetUsd must be an integer from 5 through 250');
  }
  if (!/^[A-Za-z0-9._:/=+@-]{1,64}$/.test(config.ownerTag)) fail('ownerTag is invalid');
  if (!/^[0-9a-f]{40}$/.test(config.sourceCommit) || config.sourceCommit === '0'.repeat(40)) fail('sourceCommit must be a real full lowercase commit SHA');
  return config;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`cannot read JSON ${file}: ${error.message}`); }
}

function verifyRepositoryAndBundle(root, config, run = execFileSync) {
  const git = args => run('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const head = git(['rev-parse', 'HEAD']);
  if (head !== config.sourceCommit) fail(`sourceCommit does not match HEAD (${head})`);
  if (git(['status', '--porcelain=v1', '--untracked-files=all'])) fail('repository checkout is dirty');

  for (const relative of [
    'infrastructure/aws-staging-signing-key.template.json',
    'infrastructure/aws-staging-intake.template.json'
  ]) readJson(path.join(root, relative));

  const prefix = `fcc-staging-lambda-${config.sourceCommit}`;
  const manifestPath = path.join(root, 'staging', 'aws', `${prefix}.manifest.json`);
  const manifest = readJson(manifestPath);
  if (manifest.schemaVersion !== 1 || manifest.environment !== 'staging') fail('bundle manifest is not staging schema version 1');
  if (manifest.commitSha !== config.sourceCommit) fail('bundle manifest commit does not match sourceCommit');
  if (manifest.archive !== `${prefix}.zip`) fail('bundle archive name is not commit-bound');
  if (!/^[0-9a-f]{64}$/.test(manifest.archiveSha256)) fail('bundle manifest archiveSha256 is invalid');
  const archivePath = path.join(root, 'staging', 'aws', manifest.archive);
  let archive;
  try { archive = fs.readFileSync(archivePath); }
  catch (error) { fail(`cannot read bundle archive: ${error.message}`); }
  if (sha256(archive) !== manifest.archiveSha256) fail('bundle archive SHA-256 does not match manifest');
  return { head, manifestPath, archivePath, archiveSha256: manifest.archiveSha256 };
}

function awsCommandPlan(root, config) {
  return [
    ['sts', 'get-caller-identity'],
    ['s3api', 'get-bucket-location', '--bucket', config.deploymentBucket],
    ['s3api', 'get-bucket-versioning', '--bucket', config.deploymentBucket],
    ['s3api', 'get-bucket-encryption', '--bucket', config.deploymentBucket],
    ['s3api', 'get-public-access-block', '--bucket', config.deploymentBucket],
    ['s3api', 'get-bucket-policy-status', '--bucket', config.deploymentBucket],
    ['cloudformation', 'validate-template', '--template-body', `file://${path.join(root, 'infrastructure', 'aws-staging-signing-key.template.json')}`],
    ['cloudformation', 'validate-template', '--template-body', `file://${path.join(root, 'infrastructure', 'aws-staging-intake.template.json')}`]
  ];
}

function validateAwsResponses(config, responses) {
  const [identity, location, versioning, encryption, publicAccess, policyStatus] = responses;
  if (identity.Account !== config.expectedAccountId) fail(`AWS caller account ${identity.Account} does not match expectedAccountId`);
  let bucketRegion = location.LocationConstraint;
  if (bucketRegion === null || bucketRegion === '') bucketRegion = 'us-east-1';
  if (bucketRegion === 'EU') bucketRegion = 'eu-west-1';
  if (bucketRegion !== config.region) fail(`deployment bucket is in ${bucketRegion}, not ${config.region}`);
  if (versioning.Status !== 'Enabled') fail('deployment bucket versioning is not Enabled');
  const rules = encryption.ServerSideEncryptionConfiguration?.Rules;
  if (!Array.isArray(rules) || !rules.length || rules.some(rule => !['AES256', 'aws:kms'].includes(rule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm))) {
    fail('deployment bucket default encryption is missing or unsupported');
  }
  const block = publicAccess.PublicAccessBlockConfiguration || {};
  for (const key of ['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets']) {
    if (block[key] !== true) fail(`deployment bucket public-access control ${key} is not true`);
  }
  if (policyStatus.PolicyStatus?.IsPublic !== false) fail('deployment bucket policy is public or unverifiable');
  return { accountId: identity.Account, bucketRegion, versioning: versioning.Status, encryption: 'verified', publicAccess: 'blocked' };
}

function runAwsReadOnly(root, config, run = execFileSync) {
  const common = ['--no-cli-pager', '--region', config.region];
  const responses = awsCommandPlan(root, config).map(args => {
    const output = run('aws', [...common, ...args, '--output', 'json'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, AWS_PAGER: '', AWS_EC2_METADATA_DISABLED: 'true' }
    });
    return JSON.parse(output || '{}');
  });
  return validateAwsResponses(config, responses);
}

function main() {
  const root = path.resolve(__dirname, '..');
  const configPath = path.resolve(process.argv[2] || path.join(root, 'staging', 'aws', 'preflight.json'));
  const config = validateConfig(readJson(configPath));
  const bundle = verifyRepositoryAndBundle(root, config);
  const aws = runAwsReadOnly(root, config);
  console.log(JSON.stringify({ status: 'PASS', environment: 'staging', bundle, aws }, null, 2));
}

module.exports = { validateConfig, verifyRepositoryAndBundle, awsCommandPlan, validateAwsResponses, runAwsReadOnly };
if (require.main === module) {
  try { main(); }
  catch (error) { console.error(`AWS STAGING PREFLIGHT FAILED: ${error.message}`); process.exitCode = 1; }
}
