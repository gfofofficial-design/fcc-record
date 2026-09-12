'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  validateConfig, verifyRepositoryAndBundle, awsCommandPlan, validateAwsResponses
} = require('../tools/run-aws-staging-preflight');

const root = path.join(__dirname, '..');
const config = {
  schemaVersion: 1,
  environment: 'staging',
  expectedAccountId: '123456789012',
  region: 'us-east-2',
  deploymentBucket: 'fcc-staging-deployments-123456789012',
  budgetAlertEmail: 'alerts@gfof.invalid',
  monthlyBudgetUsd: 25,
  ownerTag: 'GFOF-FCC',
  sourceCommit: 'a'.repeat(40)
};

function responses() {
  return [
    { Account: config.expectedAccountId, Arn: 'arn:aws:iam::123456789012:role/reviewer' },
    { LocationConstraint: config.region },
    { Status: 'Enabled' },
    { ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'aws:kms' } }] } },
    { PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } },
    { PolicyStatus: { IsPublic: false } },
    { Description: 'key template' },
    { Description: 'service template' }
  ];
}

test('configuration is staging-only, exact, and rejects placeholders', () => {
  assert.deepEqual(validateConfig({ ...config }), config);
  assert.throws(() => validateConfig({ ...config, environment: 'production' }), /must be staging/);
  assert.throws(() => validateConfig({ ...config, region: 'us-gov-west-1' }), /commercial AWS region/);
  assert.throws(() => validateConfig({ ...config, budgetAlertEmail: 'owner@example.com' }), /real alert address/);
  assert.throws(() => validateConfig({ ...config, expectedAccountId: '000000000000' }), /real 12-digit account ID/);
  assert.throws(() => validateConfig({ ...config, sourceCommit: '0'.repeat(40) }), /real full lowercase commit SHA/);
  assert.throws(() => validateConfig({ ...config, extra: true }), /unknown configuration keys/);
});

test('AWS command plan is strictly read-only', () => {
  const plan = awsCommandPlan(root, config);
  assert.deepEqual(plan.map(command => command.slice(0, 2)), [
    ['sts', 'get-caller-identity'],
    ['s3api', 'get-bucket-location'],
    ['s3api', 'get-bucket-versioning'],
    ['s3api', 'get-bucket-encryption'],
    ['s3api', 'get-public-access-block'],
    ['s3api', 'get-bucket-policy-status'],
    ['cloudformation', 'validate-template'],
    ['cloudformation', 'validate-template']
  ]);
  assert.ok(plan.every(command => /^(get-|validate-)/.test(command[1])));
});

test('repository and commit-bound bundle must be clean and byte-exact', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-aws-preflight-'));
  const make = (relative, data) => {
    const target = path.join(temporary, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    return target;
  };
  make('infrastructure/aws-staging-signing-key.template.json', '{}');
  make('infrastructure/aws-staging-intake.template.json', '{}');
  const archiveName = `fcc-staging-lambda-${config.sourceCommit}.zip`;
  const archive = Buffer.from('exact archive bytes');
  const digest = crypto.createHash('sha256').update(archive).digest('hex');
  const archivePath = make(`staging/aws/${archiveName}`, archive);
  make(`staging/aws/fcc-staging-lambda-${config.sourceCommit}.manifest.json`, JSON.stringify({
    schemaVersion: 1, environment: 'staging', commitSha: config.sourceCommit,
    archive: archiveName, archiveSha256: digest
  }));
  const cleanGit = (_file, args) => args[0] === 'rev-parse' ? `${config.sourceCommit}\n` : '';
  assert.equal(verifyRepositoryAndBundle(temporary, config, cleanGit).archiveSha256, digest);
  fs.appendFileSync(archivePath, 'tamper');
  assert.throws(() => verifyRepositoryAndBundle(temporary, config, cleanGit), /does not match manifest/);
  const dirtyGit = (_file, args) => args[0] === 'rev-parse' ? `${config.sourceCommit}\n` : ' M package.json\n';
  assert.throws(() => verifyRepositoryAndBundle(temporary, config, dirtyGit), /checkout is dirty/);
});

test('valid AWS identity and private versioned encrypted bucket pass', () => {
  assert.deepEqual(validateAwsResponses(config, responses()), {
    accountId: config.expectedAccountId,
    bucketRegion: config.region,
    versioning: 'Enabled',
    encryption: 'verified',
    publicAccess: 'blocked'
  });
});

test('account, region, versioning, encryption, and public access fail closed', () => {
  for (const mutate of [
    r => { r[0].Account = '000000000000'; },
    r => { r[1].LocationConstraint = 'us-west-2'; },
    r => { r[2].Status = 'Suspended'; },
    r => { r[3] = {}; },
    r => { r[4].PublicAccessBlockConfiguration.BlockPublicPolicy = false; },
    r => { r[5].PolicyStatus.IsPublic = true; }
  ]) {
    const value = responses(); mutate(value);
    assert.throws(() => validateAwsResponses(config, value));
  }
});

test('us-east-1 and legacy EU bucket locations normalize exactly', () => {
  let value = responses(); value[1].LocationConstraint = null;
  assert.equal(validateAwsResponses({ ...config, region: 'us-east-1' }, value).bucketRegion, 'us-east-1');
  value = responses(); value[1].LocationConstraint = 'EU';
  assert.equal(validateAwsResponses({ ...config, region: 'eu-west-1' }, value).bucketRegion, 'eu-west-1');
});
