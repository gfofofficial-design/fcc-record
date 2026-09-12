'use strict';
const { KMSClient } = require('@aws-sdk/client-kms');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { SQSClient } = require('@aws-sdk/client-sqs');
const { createStagingIntake } = require('./lib/aws-staging-intake');
let service;
function configured() {
  if (!service) service = createStagingIntake({
    environment: process.env.FCC_ENVIRONMENT, table: process.env.FCC_INTAKE_TABLE,
    queueUrl: process.env.FCC_RECEIPT_QUEUE_URL, keyArn: process.env.FCC_INTAKE_KEY_ARN,
    publicKey: process.env.FCC_INTAKE_PUBLIC_KEY_PEM, keyVersion: process.env.FCC_INTAKE_KEY_VERSION,
    db: DynamoDBDocumentClient.from(new DynamoDBClient({})), kms: new KMSClient({}), sqs: new SQSClient({})
  });
  return service;
}
exports.handler = event => configured().handler(event);
exports.dispatch = () => configured().dispatch();
