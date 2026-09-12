# AWS staging infrastructure review and deployment

These CloudFormation templates make the existing FCC staging intake implementation reviewable and reproducible. They do not deploy themselves. They create only staging resources, and they do not grant any caller permission to invoke the intake route.

## Safety state

- No production resource names, identifiers, keys, credentials, publishers, or consumers are created.
- The HTTP API exposes only `POST /staging/intake` and requires AWS Signature Version 4 through `AWS_IAM` authorization.
- No caller role or access key is created. A separate principal review is required before anyone can invoke the API.
- The outbox dispatcher EventBridge schedule is created as `DISABLED`.
- Lambda reserved concurrency, API throttles, on-demand DynamoDB billing, 30-day log retention, and a monthly AWS Budget alert bound staging cost and capacity.
- Lambda uses the supported Node.js 24 runtime; CI tests the repository on the same major version.
- The DynamoDB table, SQS queue, KMS key, and log groups are retained if a stack is deleted. The table also has deletion protection and point-in-time recovery.
- Budget alerts are warnings, not automatic shutdown controls.

## Files

- `aws-staging-signing-key.template.json`: dedicated single-region `ECC_NIST_EDWARDS25519` signing key and alias.
- `aws-staging-intake.template.json`: table, queue, Lambda functions, separated IAM roles, authenticated API, disabled schedule, logs, alarm, and budget.
- `../tests/aws-staging-infrastructure.test.js`: static invariants that prevent accidental weakening of those controls.

## Required owner decisions

Do not deploy until all five values are deliberately chosen and recorded outside this repository:

1. Dedicated AWS staging account ID.
2. Commercial AWS region that supports the required Ed25519 KMS key.
3. Existing encrypted, versioned S3 deployment bucket in that account and region.
4. Confirmed budget-alert email address and monthly USD limit.
5. A commit SHA whose exact source and pinned production dependencies will be packaged.

The current application validates commercial `arn:aws:kms:...` ARNs and the commercial SQS URL form. The templates therefore intentionally reject GovCloud and China partitions.

## Review locally

See `STAGING_REHEARSAL.md` for the local rehearsal, read-only quota gate, bounded smoke tests, draft caller permission, and failed-deployment recovery procedure. Run the quota gate before recreating a change set after a quota-related failure.

```sh
npm ci
npm run test:aws
npm run test:infra
npm run test:aws-bundle
npm run test:aws-preflight
aws cloudformation validate-template --template-body file://infrastructure/aws-staging-signing-key.template.json
aws cloudformation validate-template --template-body file://infrastructure/aws-staging-intake.template.json
```

The first two commands require no AWS account. The `validate-template` commands are read-only AWS API calls and require configured AWS credentials.

## Two-phase deployment sequence

### 1. Create and inspect the signing key

Deploy `aws-staging-signing-key.template.json` in the selected staging account and region. Record the stack output `SigningKeyArn`; never substitute the alias.

Before proceeding, use `kms:GetPublicKey` to confirm:

- `KeySpec` is `ECC_NIST_EDWARDS25519`;
- `KeyUsage` is `SIGN_VERIFY`; and
- `SigningAlgorithms` contains `ED25519_SHA_512`.

Export the returned DER public-key bytes as a PEM public key. Keep the PEM with the deployment parameters, not in `governance/keys/`; a staging infrastructure key is not a ratified production governance key.

### 2. Build a commit-specific Lambda zip

From a clean checkout of the approved commit, install the pinned lockfile and build the deterministic, commit-bound archive:

```sh
npm ci
npm run build:aws-bundle
```

The builder refuses a dirty checkout, verifies every declared runtime dependency is installed, packages only the intake entry point and its local runtime modules plus `node_modules/` and the package manifests, normalizes ZIP metadata, and writes both the archive and a JSON manifest under the git-ignored `staging/aws/` directory. The archive filename contains the full commit SHA; rerunning the command at the same commit must produce the same SHA-256 digest. It will not overwrite an existing archive or manifest with different bytes.

Upload the archive to the versioned deployment bucket under a key containing the full commit SHA. Do not reuse or overwrite a prior object key.

Record the manifest's archive SHA-256 digest and the S3 object version before creating the service stack. The current template takes a commit-specific `CodeS3Key`; object immutability and bucket versioning remain operator prerequisites.

### 2a. Run the read-only AWS preflight

Copy `infrastructure/aws-staging-preflight.example.json` to the git-ignored path `staging/aws/preflight.json` and replace every placeholder with the five recorded owner decisions and the full approved commit SHA. Then run:

```sh
npm run preflight:aws
```

The preflight fails unless the checkout is clean, the bundle and manifest match the exact `HEAD`, the configured AWS caller is in the expected 12-digit account, the bucket is in the selected commercial region with versioning and default encryption enabled, all four bucket-level public-access blocks are true, the bucket policy is non-public, and AWS accepts both CloudFormation templates. Its AWS command allowlist contains only identity, bucket-inspection, and template-validation calls; it cannot create, update, upload, deploy, or delete anything.

### 3. Create a CloudFormation change set

Supply these parameters to `aws-staging-intake.template.json`:

- `CodeS3Bucket`
- `CodeS3Key`
- `SigningKeyArn`
- `SigningPublicKeyPem`
- `BudgetAlertEmail`
- `MonthlyBudgetUsd`
- `OwnerTag`

Create a change set first and review every IAM and resource change. Deployment requires `CAPABILITY_IAM`. Confirm the budget email subscription after stack creation.

### 4. Prove the stack remains inert

Before granting a caller any permission, confirm:

- the dispatcher rule state is `DISABLED`;
- the API route authorization is `AWS_IAM`;
- the receipt table has deletion protection and point-in-time recovery enabled;
- the intake role can call only `GetItem`, `PutItem` (including the transaction's two puts), `Sign`, `SendMessage`, and its own log stream operations;
- the dispatcher role has no KMS permission;
- there is no SQS consumer or public publisher; and
- unauthenticated requests receive `403` without executing the Lambda function.

### 5. Separately authorize a bounded staging caller

Caller authorization is intentionally outside these templates. Review a dedicated staging principal with only `execute-api:Invoke` for the exact API, stage, method, and route. Do not create long-lived embedded credentials. Run a bounded test window using only `FCC-TEST-*` identifiers and random 32–128 character idempotency keys.

Keep the dispatcher disabled until a queue consumer and duplicate-delivery handling have been implemented and tested. Queue delivery is not public admission, and DynamoDB remains the retry source of truth.

## Teardown warning

Deleting either stack does not delete the KMS key, DynamoDB table, SQS queue, or log groups because they are retained. That is intentional evidence-preservation behavior. Inventory retained resources and obtain explicit approval before any later destructive cleanup.
