# Outbox worker runbook

The outbox runner is a portable, one-shot process intended for a scheduler such as cron, a container job, or a platform scheduler. It authenticates with a topic-specific worker token and does not create or depend on a human web session.

## Supported workers

- `notification_delivery` sends `notifications.email` and `notifications.digest` jobs through the configured idempotent HTTP email provider.
- `sop_delivery` closes `sop.assignment` jobs only after the durable assignment, exact SOP version, content hash, lab, and lease authority are revalidated in the completion transaction. The assignment command has already committed the assignment and audit atomically; the queued job has no additional external side effect and is only its durable completion acknowledgement. It does not claim other topics or call an external provider.

`notifications.in_app` is intentionally not in the notification worker allowlist. Dashboard notifications are materialized in the originating database workflow, and no producer enqueues that topic. Claiming it would falsely imply an unsupported delivery side effect.

Other outbox topics do not have a production consumer in this runner. Do not schedule a worker type for them until a real, idempotent consumer exists.

## Required environment

Set `OUTBOX_WORKER_TYPE` to one supported worker type and give each scheduled process a non-sensitive `OUTBOX_WORKER_ID`. Configure the matching secret with at least 32 characters:

- `OUTBOX_WORKER_TOKEN_NOTIFICATION_DELIVERY`
- `OUTBOX_WORKER_TOKEN_SOP_DELIVERY`

Notification delivery also uses:

- `NOTIFICATION_EMAIL_PROVIDER_URL`
- `NOTIFICATION_EMAIL_PROVIDER_HOSTS` (required allowlist in production)
- `NOTIFICATION_EMAIL_FROM`
- `NOTIFICATION_EMAIL_API_TOKEN` when the provider requires it
- `NOTIFICATION_EMAIL_PROVIDER_SUPPORTS_IDEMPOTENCY=true` only after confirming that the provider honors the `Idempotency-Key` header
- the `notify_email_enabled` database rule

Use a dedicated secret per worker type. Never put the token in command-line arguments or `OUTBOX_WORKER_ID`; command lines and worker IDs may be observable.

Run one invocation with:

```sh
npm run worker:outbox
```

The scheduler should invoke the command periodically rather than keeping it resident. Overlapping invocations are safe because claims use database row locks and unique leases.

## Bounded settings

All numeric environment settings are hard-clamped even if a deployment supplies a larger value.

| Setting | Default | Accepted effective range |
| --- | ---: | ---: |
| `OUTBOX_WORKER_BATCH_SIZE` | 25 | 1–100 jobs |
| `OUTBOX_WORKER_CONCURRENCY` | 2 | 1–8 lanes |
| `OUTBOX_WORKER_PROVIDER_TIMEOUT_MS` | 10000 | 1000–30000 ms |
| `OUTBOX_WORKER_RUN_TIMEOUT_MS` | 60000 | 30000–600000 ms |
| `OUTBOX_WORKER_LEASE_MS` | 2 × provider timeout + 20000 | 30000–900000 ms, never shorter than DNS + HTTP + finalization |
| `OUTBOX_WORKER_MAINTENANCE_LIMIT` | 25 | 1–100 expired leases |

New jobs are clamped to 1–12 attempts. The provider timeout is reduced when necessary to fit the effective run window. Each execution lane claims only one job immediately before processing it, so waiting behind the rest of a claimed batch cannot consume the lease. A run that crosses its deadline after a call is reported as `timed_out`, including a one-job run.

One scheduled invocation attempts each message at most once. A failed message may be retried only by a later invocation after its durable `availableAt` backoff, preventing one provider outage from consuming several attempts in a tight loop.

Expired leases are swept in a bounded maintenance pass before provider configuration is checked. Therefore a disabled or temporarily misconfigured notification provider does not leave crashed leases active forever. A non-final expired attempt becomes ready for retry; an expired final attempt becomes a dead letter.

## Scheduler result and alerts

The process writes exactly one structured JSON summary to standard output. It contains run identity, worker type, outcome, aggregate counts, effective limits, timestamps, and duration. It does not contain queue payloads, recipient addresses, provider request bodies, tokens, aggregate IDs, lease tokens, or error text from individual jobs.

- Exit `0`: completed without job failures, or notification delivery is intentionally disabled after lease maintenance.
- Exit `1`: a job failed, a final expired lease was dead-lettered, the run deadline was reached, or the process failed unexpectedly. The provider idempotency key makes a later retry safe after an ambiguous network failure.
- Exit `2`: worker authentication or enabled-provider configuration is invalid. Fix configuration rather than retrying rapidly.

The System page shows per-topic ready, scheduled, retry, active-lease, expired-lease, and dead-letter counts, oldest-ready lag, and recent aggregate worker-run health. It deliberately omits payloads, provider bodies, recipient data, lease tokens, aggregate IDs, and job error messages.

Alert on any expired lease or dead letter, repeated exit `1`/`2`, or oldest-ready lag above the facility's delivery objective. For a dead letter, inspect restricted application logs and provider records using the durable delivery ID; do not copy sensitive provider bodies into general scheduler logs.

## Deployment decisions

Before enabling production scheduling, the operator must choose the schedule frequency, the oldest-ready-lag alert threshold, and the platform secret store. Notification delivery additionally requires a provider whose idempotency behavior has been tested and an explicit public-host allowlist. These are deployment choices, not application defaults.

## Local synthetic queue probe

`npm run probe:m10-outbox` provides a reproducible local-only timing probe through the normal urgent-alert materializer and production notification worker. It does not insert queue records directly, reset a database, drop a schema, or delete its evidence afterward.

Prepare a newly migrated, normally seeded PostgreSQL database or schema on loopback whose database name or schema contains `mcm_test_m10_queue`. Use exactly the same raw value for `DATABASE_URL` and `DIRECT_DATABASE_URL`. The probe requires the normal seeded `user-admin`, `lab-microglia`, `cage-a101-001`, and `notify_email_enabled` rule. It refuses to write if any `NotificationEvent`, `NotificationDelivery`, `OutboxMessage`, or `OutboxDeliveryAttempt` row already exists.

Set these explicit probe variables:

```sh
M10_QUEUE_PROBE=true
M10_QUEUE_PROBE_ARTIFACT_DIR=/absolute/project/.runtime-data/m10-load/queue-probes
```

The artifact directory must be under `.runtime-data/m10-load`, outside the active worktree. The probe creates mode-`0700` directories and mode-`0600` `summary.json` and `summary.md` files. They contain only aggregate queue-wait (`availableAt` to attempt `startedAt`), service (`startedAt` to `completedAt`), and end-to-end (`createdAt` to `deliveredAt`) p50, p95, maximum, and count. They never contain job IDs, database or provider URLs, email addresses, payloads, request bodies, logs, tokens, or individual timing rows.

The probe starts an in-process loopback HTTP provider that honors the durable idempotency key, enables the real database delivery rule, materializes one unique critical welfare alert, runs the bounded `notification_delivery` worker, and verifies every delivery and first attempt reached the delivered state. The dedicated database is deliberately preserved for operator review; use a new dedicated database/schema for each subsequent probe.
