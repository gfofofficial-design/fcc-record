'use strict';
const crypto = require('crypto');
const canonicalize = require('canonicalize');
const { makeUlidGenerator } = require('./ulid');
const { SignCommand } = require('@aws-sdk/client-kms');
const { GetCommand, TransactWriteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { SendMessageCommand } = require('@aws-sdk/client-sqs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function createStagingIntake({ db, kms, sqs, table, queueUrl, keyArn, publicKey, keyVersion, environment,
  now = () => new Date().toISOString(), nextId = makeUlidGenerator() }) {
  if (environment !== 'staging' || !/^fcc-staging-/.test(table || '') ||
      !/^FCC-TEST-KEY-[1-9][0-9]*$/.test(keyVersion || '')) throw Error('Staging configuration required');
  const arn = /^arn:aws:kms:([a-z0-9-]+):([0-9]{12}):key\/[a-f0-9-]{36}$/.exec(keyArn || '');
  if (!arn || queueUrl !== `https://sqs.${arn[1]}.amazonaws.com/${arn[2]}/fcc-staging-receipts`) throw Error('Scoped KMS key and staging queue required');
  const key = crypto.createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519') throw Error('Ed25519 public key required');
  const response = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(body) });
  const get = async pk => (await db.send(new GetCommand({ TableName: table, Key: { pk }, ConsistentRead: true }))).Item;
  const notify = receiptId => sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify({ receipt_id: receiptId, fixture_only: true }) }));

  async function handler(event) {
    if (event?.requestContext?.http?.method !== 'POST') return response(405, { error: 'POST required' });
    const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k,v]) => [k.toLowerCase(),v]));
    if (!/^application\/json(?:\s*;|$)/i.test(headers['content-type'] || '')) return response(415, { error: 'JSON required' });
    const token = headers['idempotency-key'];
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) return response(400, { error: 'A random Idempotency-Key of 32-128 characters is required' });
    let submission, canonical;
    try {
      if (typeof event.body !== 'string' || event.body.length > 90000) return response(413, { error: 'Body too large' });
      const bytes = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
      if (bytes.length > 65536) return response(413, { error: 'Body too large' });
      submission = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!submission || Array.isArray(submission) || typeof submission !== 'object' ||
          !/^FCC-TEST-[A-Z0-9-]{1,80}$/.test(submission.instrument_id || '')) return response(400, { error: 'Test instrument required' });
      canonical = canonicalize(submission);
    } catch { return response(400, { error: 'Invalid JSON submission' }); }
    const contentHash = hash(canonical), pk = 'REQUEST#' + hash(token);
    try {
      let saved = await get(pk);
      if (!saved) {
        const body = { provisional_receipt_id: nextId(), instrument_id: submission.instrument_id,
          challenge_content_sha256: contentHash, received_at: now(), intake_key_version: keyVersion, fixture_only: true };
        const message = Buffer.from(canonicalize(body));
        const signed = await kms.send(new SignCommand({ KeyId: keyArn, Message: message, MessageType: 'RAW', SigningAlgorithm: 'ED25519_SHA_512' }));
        if (signed.KeyId !== keyArn || signed.SigningAlgorithm !== 'ED25519_SHA_512' || !signed.Signature ||
            !crypto.verify(null, message, key, signed.Signature)) throw Error('Invalid KMS signature');
        const receipt = { ...body, signature: Buffer.from(signed.Signature).toString('base64') };
        const candidate = { pk, content_hash: contentHash, receipt, submission };
        try {
          await db.send(new TransactWriteCommand({ TransactItems: [
            { Put: { TableName: table, Item: candidate, ConditionExpression: 'attribute_not_exists(pk)' } },
            { Put: { TableName: table, Item: { pk: 'OUTBOX#' + body.provisional_receipt_id, request_pk: pk,
              receipt_id: body.provisional_receipt_id, publication_status: 'PENDING', fixture_only: true }, ConditionExpression: 'attribute_not_exists(pk)' } }
          ] }));
          saved = candidate;
        } catch (error) {
          // An ambiguous commit or concurrent retry must return the stored original.
          saved = await get(pk);
          if (!saved) throw error;
        }
      }
      if (saved.content_hash !== contentHash) return response(409, { error: 'Idempotency-Key already used for another submission' });
      let queued = true;
      try { await notify(saved.receipt.provisional_receipt_id); } catch { queued = false; }
      return response(202, { receipt: saved.receipt, publication_status: 'PENDING', queued,
        fixture_only: true, message: 'Signed staging receipt retained; no public admission' });
    } catch { return response(503, { error: 'Receipt not acknowledged; retry with the same Idempotency-Key' }); }
  }

  async function dispatch() {
    let cursor, sent = 0, failed = 0;
    do {
      const page = await db.send(new ScanCommand({ TableName: table, ExclusiveStartKey: cursor,
        FilterExpression: 'begins_with(pk, :prefix) AND publication_status = :pending',
        ExpressionAttributeValues: { ':prefix': 'OUTBOX#', ':pending': 'PENDING' }, Limit: 100 }));
      for (const item of page.Items || []) {
        try { await notify(item.receipt_id); sent++; } catch { failed++; }
      }
      cursor = page.LastEvaluatedKey;
    } while (cursor);
    // Queue delivery is never treated as publication. Pending rows are retained.
    return { sent, failed, publication_active: false };
  }
  return { handler, dispatch };
}
module.exports = { createStagingIntake };
