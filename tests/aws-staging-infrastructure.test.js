'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const load = name => JSON.parse(fs.readFileSync(path.join(root, 'infrastructure', name), 'utf8'));
const key = load('aws-staging-signing-key.template.json');
const service = load('aws-staging-intake.template.json');
const resourcesByType = (template, type) => Object.entries(template.Resources)
  .filter(([, value]) => value.Type === type)
  .map(([name, value]) => ({ name, ...value }));
const statements = role => role.Properties.Policies.flatMap(policy => policy.PolicyDocument.Statement);
const actions = statement => Array.isArray(statement.Action) ? statement.Action : [statement.Action];

test('signing key is a retained, single-region Ed25519 signing authority', () => {
  const kms = key.Resources.ReceiptSigningKey;
  assert.equal(kms.Type, 'AWS::KMS::Key');
  assert.equal(kms.DeletionPolicy, 'Retain');
  assert.equal(kms.UpdateReplacePolicy, 'Retain');
  assert.equal(kms.Properties.KeySpec, 'ECC_NIST_EDWARDS25519');
  assert.equal(kms.Properties.KeyUsage, 'SIGN_VERIFY');
  assert.equal(kms.Properties.MultiRegion, false);
  assert.equal(kms.Properties.BypassPolicyLockoutSafetyCheck, false);
  assert.equal(kms.Properties.PendingWindowInDays, 30);
  assert.ok(!Object.hasOwn(kms.Properties, 'EnableKeyRotation'), 'asymmetric keys must not request automatic rotation');
  assert.equal(key.Outputs.SigningAlgorithm.Value, 'ED25519_SHA_512');
});

test('service accepts only an immutable commercial-AWS KMS key ARN', () => {
  const pattern = new RegExp(service.Parameters.SigningKeyArn.AllowedPattern);
  assert.match('arn:aws:kms:us-east-2:123456789012:key/12345678-1234-1234-1234-123456789abc', pattern);
  assert.doesNotMatch('arn:aws:kms:us-east-2:123456789012:alias/fcc-staging-intake-receipts', pattern);
  assert.doesNotMatch('arn:aws-us-gov:kms:us-gov-west-1:123456789012:key/12345678-1234-1234-1234-123456789abc', pattern);
});

test('receipt source of truth is on-demand, encrypted, recoverable, and retained', () => {
  const table = service.Resources.ReceiptTable;
  assert.equal(table.Properties.TableName, 'fcc-staging-intake');
  assert.equal(table.Properties.BillingMode, 'PAY_PER_REQUEST');
  assert.deepEqual(table.Properties.KeySchema, [{ AttributeName: 'pk', KeyType: 'HASH' }]);
  assert.equal(table.Properties.DeletionProtectionEnabled, true);
  assert.equal(table.Properties.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled, true);
  assert.equal(table.Properties.SSESpecification.SSEEnabled, true);
  assert.equal(table.DeletionPolicy, 'Retain');
  assert.equal(table.UpdateReplacePolicy, 'Retain');
});

test('queue is encrypted, bounded, retained, and matches the application contract', () => {
  const queue = service.Resources.ReceiptQueue;
  assert.equal(queue.Properties.QueueName, 'fcc-staging-receipts');
  assert.equal(queue.Properties.SqsManagedSseEnabled, true);
  assert.equal(queue.Properties.MessageRetentionPeriod, 1209600);
  assert.equal(queue.DeletionPolicy, 'Retain');
  assert.equal(queue.UpdateReplacePolicy, 'Retain');
});

test('intake and dispatcher roles remain separated by least privilege', () => {
  const intakeActions = statements(service.Resources.IntakeRole).flatMap(actions);
  const dispatcherActions = statements(service.Resources.DispatcherRole).flatMap(actions);
  assert.deepEqual(new Set(intakeActions), new Set([
    'logs:CreateLogStream', 'logs:PutLogEvents', 'dynamodb:GetItem',
    'dynamodb:PutItem', 'kms:Sign', 'sqs:SendMessage'
  ]));
  assert.deepEqual(new Set(dispatcherActions), new Set([
    'logs:CreateLogStream', 'logs:PutLogEvents', 'dynamodb:Scan', 'sqs:SendMessage'
  ]));
  assert.ok(!dispatcherActions.some(action => action.startsWith('kms:')), 'dispatcher must never receive signing permission');
  const sign = statements(service.Resources.IntakeRole).find(statement => actions(statement).includes('kms:Sign'));
  assert.equal(sign.Condition.StringEquals['kms:SigningAlgorithm'], 'ED25519_SHA_512');
  assert.deepEqual(sign.Resource, { Ref: 'SigningKeyArn' });
});

test('both functions are staging-only, bounded, and use the expected handlers', () => {
  const functions = resourcesByType(service, 'AWS::Lambda::Function');
  assert.equal(functions.length, 2);
  for (const fn of functions) {
    assert.equal(fn.Properties.Runtime, 'nodejs24.x');
    assert.deepEqual(fn.Properties.Architectures, ['arm64']);
    assert.equal(fn.Properties.Environment.Variables.FCC_ENVIRONMENT, 'staging');
    assert.equal(fn.Properties.Environment.Variables.FCC_INTAKE_KEY_VERSION, 'FCC-TEST-KEY-1');
    assert.ok(fn.Properties.ReservedConcurrentExecutions <= 2);
  }
  assert.equal(service.Resources.IntakeFunction.Properties.Handler, 'tools/aws-staging-intake.handler');
  assert.equal(service.Resources.DispatcherFunction.Properties.Handler, 'tools/aws-staging-intake.dispatch');
});

test('the only API route is POST, IAM-authenticated, logged, and throttled', () => {
  const routes = resourcesByType(service, 'AWS::ApiGatewayV2::Route');
  assert.equal(routes.length, 1);
  assert.equal(routes[0].Properties.RouteKey, 'POST /staging/intake');
  assert.equal(routes[0].Properties.AuthorizationType, 'AWS_IAM');
  const settings = service.Resources.IntakeStage.Properties.DefaultRouteSettings;
  assert.equal(settings.ThrottlingBurstLimit, 5);
  assert.equal(settings.ThrottlingRateLimit, 2);
  assert.ok(service.Resources.IntakeStage.Properties.AccessLogSettings);
});

test('outbox automation remains disabled until a bounded staging window', () => {
  const rule = service.Resources.DisabledDispatcherSchedule;
  assert.equal(rule.Type, 'AWS::Events::Rule');
  assert.equal(rule.Properties.State, 'DISABLED');
  assert.equal(service.Outputs.DispatcherScheduleState.Value, 'DISABLED');
  assert.equal(service.Outputs.ProductionActivated.Value, 'false');
});

test('cost and telemetry guardrails are explicit', () => {
  assert.equal(service.Parameters.MonthlyBudgetUsd.Default, 25);
  assert.equal(service.Parameters.MonthlyBudgetUsd.MaxValue, 250);
  const budget = service.Resources.MonthlyCostBudget.Properties;
  assert.equal(budget.Budget.BudgetType, 'COST');
  assert.equal(budget.Budget.TimeUnit, 'MONTHLY');
  assert.deepEqual(budget.Budget.CostFilters.TagKeyValue, ['user:Environment$staging']);
  assert.deepEqual(budget.NotificationsWithSubscribers.map(x => x.Notification.NotificationType), ['ACTUAL', 'FORECASTED']);
  assert.equal(service.Resources.IntakeErrorAlarm.Type, 'AWS::CloudWatch::Alarm');
  for (const log of resourcesByType(service, 'AWS::Logs::LogGroup')) {
    assert.equal(log.Properties.RetentionInDays, 30);
    assert.equal(log.DeletionPolicy, 'Retain');
  }
});

test('no template creates an authenticated caller or activates production', () => {
  assert.equal(resourcesByType(service, 'AWS::IAM::User').length, 0);
  assert.equal(resourcesByType(service, 'AWS::IAM::AccessKey').length, 0);
  assert.equal(resourcesByType(service, 'AWS::Cognito::UserPool').length, 0);
  const productionTags = Object.values(service.Resources)
    .flatMap(resource => Array.isArray(resource.Properties?.Tags) ? resource.Properties.Tags : [])
    .filter(tag => tag.Key === 'Production');
  assert.ok(productionTags.length >= 5);
  assert.ok(productionTags.every(tag => tag.Value === 'false'));
});
