# FCC staging rehearsal and activation checklist

All local tests below run without AWS credentials or changes to cloud resources. A local pass is not a claim that a live deployment works.

## Local rehearsal

From the authorized checkout, install the pinned dependencies with `npm ci`, select Python with the pinned requirements on PATH, and run:

```sh
npm run test:aws
npm run test:infra
npm run test:aws-bundle
npm run test:aws-preflight
npm run test:aws-quota
```

These cover signed receipts, concurrent/idempotent requests, unavailable signing/storage/queue services, ambiguous transaction outcomes, paginated retry dispatch, template boundaries, deterministic packaging, and read-only preflight failures. From a clean committed checkout, run `npm run build:aws-bundle` twice. Both manifests must report the same archive digest. Preserve the existing CloudShell deployment bundle: a new local commit does not authorize replacing its approved source.

## Quota gate before any redeployment

Run the read-only command in the authenticated AWS environment using its existing preflight configuration:

```sh
npm run check:aws-quota -- staging/aws/preflight.json a13b2b5ea91d470793e92d989de32ba5hiv6RYlP 178923331400291
```

The command verifies caller account, exact request/case, Ohio or the explicitly configured region, Lambda concurrent-execution quota identity, APPROVED status, and Lambda's actual account limits. It requires the requested increase to be fully applied and conservatively preserves 100 unreserved units after the template's reservations (currently 2 + 1). This 100-unit margin is an explicit rehearsal guard, not a claim about the earlier new-account minimum. If AWS grants a different value, review the decision rather than weakening this guard silently. It is a fresh-deployment check, not an update-capacity calculator. Errors, absent fields, account mismatches and insufficient capacity fail closed. It cannot deploy, submit another request, or modify a quota. A PASS does not reserve capacity; recheck immediately before deployment.

Then rerun the existing AWS preflight for the approved source/bundle and review the new change set. Do not recreate the already-preserved signing key or change concurrency reservations to bypass the open case.

## Staging smoke test sequence after deployment

1. Inspect the actual stack and resources: route authorization AWS_IAM, dispatcher DISABLED, reserved concurrency 2/1, table protection and backups enabled, no public publisher or queue consumer. Check effective IAM permissions, not only template text.
2. Send one unauthenticated POST to the exact deployed `/staging/staging/intake` URL. Expect 403 and no Lambda invocation or receipt row.
3. After separately authorizing the bounded caller below, send one signed request with a fresh random Idempotency-Key and an FCC-TEST instrument. Expect 202, fixture_only true, and publication_status PENDING. Verify the receipt signature independently with the staging public key and recompute its submission hash.
4. Repeat the same submission/key, including concurrent requests. Expect the identical receipt ID and received_at, one stored request and one outbox row. Reuse that key with different content: expect 409 and no replacement of the original submission.
5. Send a parseable test submission missing challenge fields with a different key. Expect retention for later triage, not silent deletion. Check malformed JSON and production instrument IDs are explicitly rejected.
6. Verify the outbox remains PENDING after SQS delivery. Queue delivery is not public admission. Leave the scheduled dispatcher disabled.
7. Exercise queue/signing/storage outages locally with the existing fakes. A live fault injection would require a separate, bounded plan; do not disable KMS, modify IAM, or purge a queue just to reproduce it.
8. Retain the test receipts and observations. Stop the test window by removing the caller's reviewed invoke permission; retain resources and records.

## Draft caller permission for review only

No role or policy is created by this document. Attach this statement only to a separately reviewed staging role using short-lived credentials after replacing every placeholder with verified stack outputs:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "execute-api:Invoke",
    "Resource": "arn:aws:execute-api:REGION:ACCOUNT_ID:API_ID/staging/POST/staging/intake"
  }]
}
```

There are no wildcard routes, administrative permissions, signing permissions, or publication credentials in this statement. Inspect other attached policies and trust relationships before treating it as an effective permission boundary. Observability reads belong to the operator, not the test caller. Do not create long-lived access keys.

## Failed-deployment recovery

Record stack status and failing logical resources, then inventory retained DynamoDB, SQS, log groups, signing key, and bundle. Preserve receipts and evidence. A rollback is not proof that resources were deleted or are empty. Do not blindly replay earlier cleanup commands: inspect current contents and obtain explicit approval for any destructive cleanup. Do not delete or rotate the preserved signing key or replace the approved bundle as a quota workaround.
