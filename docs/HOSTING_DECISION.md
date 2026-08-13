# Hosting decision record

## Decision

Use a long-running Node.js service as the first production-shaped deployment model, paired with same-region managed PostgreSQL, a bounded connection pool, persistent object storage for attachments, and a separately scheduled one-shot outbox worker.

This decides the application topology, not a cloud vendor or paid tier. A vendor/tier must not be selected from laptop measurements. The same synthetic snapshot and load profile must first pass in an explicitly approved staging candidate, after which capacity can be chosen with at least 2× measured memory and throughput headroom.

## Why this fits the current application

- The checked-in application already builds and runs as a conventional Node server.
- Runtime and migration database URLs are deliberately separate, which fits a pooled application URL plus a direct migration URL.
- Durable outbox claims and the one-shot worker need predictable scheduler execution, bounded database leases, and a secret store.
- The current attachment path under `public/uploads/attachments` is local filesystem state. It is unsuitable for ephemeral or horizontally scaled instances and must move to persistent object storage before production.
- A serverless deployment would add unresolved attachment, worker-scheduling, and per-instance connection-pool risks. It remains a future candidate only after those boundaries are externalized and the identical workload is rerun.

## Required production-shaped components

1. Node.js 22 application service with health checks and private environment configuration.
2. Same-region PostgreSQL 16 with automated backups, point-in-time recovery, encryption, monitoring, and a tested restore procedure.
3. A runtime pool plus a direct migration connection. Capacity must satisfy:

   `application instances × connection_limit + worker/migration/admin headroom < database max_connections`

4. Persistent private object storage with signed, authorization-checked attachment access; no public local upload directory.
5. Scheduler entries for each supported outbox worker type, using separate secrets and the bounds in `docs/OUTBOX_WORKER_RUNBOOK.md`.
6. Central application and database monitoring that alerts on request errors, pool exhaustion, expired leases, dead letters, and oldest-ready queue lag without copying scientific payloads into general logs.

## Evidence and limits

The local M10 harness uses only synthetic data and a dedicated loopback PostgreSQL target. It measures authenticated server-component reads, latency, throughput, response bytes, aggregate database calls, application memory, database connections, connection/pool failure signals, dataset invariants, and unexpected writes. Its artifacts intentionally omit credentials, cookies, identifiers, payloads, SQL, and response bodies.

Local evidence is suitable for finding application bottlenecks and rejecting unsafe configurations. It is not evidence for network latency, managed-database behavior, cold starts, regional availability, backup quality, or vendor cost. Queue-delay acceptance also requires a separate loopback-provider worker probe; the read-only route load does not manufacture delivery traffic.

## Measured local baseline

The final pre-commit diagnostic used Node.js 22.23.2, PostgreSQL 16.14, 9,999 synthetic animals, 2,000 cages, and 50 distinct authenticated load users. The production server handled an observed peak of 50 concurrent requests and 1,536 total samples with zero unexpected HTTP/content/network errors, zero pool or connection failures, and zero unexpected database writes.

| Measure | Result |
| --- | ---: |
| Request latency p50 / p95 | 2.795 s / 4.824 s |
| Actual throughput | 16.19 requests/s |
| Load-generator schedule-delay p95 | 35.4 s |
| Application RSS p95 / maximum | 2.302 GB / 2.413 GB |
| PostgreSQL connections maximum | 21 |
| Estimated aggregate application database calls | 44,861 |

The response-size bottleneck found in the first run was the default cage/scan page serializing the full animal-transfer workspace. Loading it only after the authorized user explicitly chooses **Move mouse** improved throughput by about 42%, reduced overall latency p95 from 7.516 s to 4.824 s, and reduced the affected route response p95 from about 4.66 MB to under 79 KB. The remaining highest-latency route in this laptop run was Workbook; it should receive first attention only if staging reproduces the same ranking.

The source-dirty runs are diagnostic rather than the final reproducibility artifact. A clean-commit run must still be retained before external staging. The schedule-delay result also shows that this laptop is not a hosting benchmark even though actual concurrency reached 50.

For the first staging candidate, 2× measured application-memory headroom is at least 4.826 GB and 2× local throughput is at least 32.38 requests/s. Use at least 6 GB of usable application memory as the initial vendor-neutral candidate floor, then accept or reject it using three identical runs and the database connection formula above. This is a capacity gate, not a vendor or tier recommendation.

The dedicated ten-delivery queue probe used the normal materializer, bounded worker, and an idempotent loopback provider. Queue wait p50/p95/max was 1,088/1,420/1,420 ms, service time was 40/285/285 ms, and end-to-end time was 736/1,030/1,030 ms. External provider latency, scheduler jitter, and recovery behavior must still be measured in staging.

## Staging acceptance gate

Before selecting a vendor/tier or calling the service production-ready:

- Run the same preserved synthetic snapshot and 50-session profile three times in the candidate region.
- Record p50/p95 latency, error rate, throughput, aggregate database calls, application and database memory, active connections, pool failures, and queue wait/service/end-to-end timing.
- Prove attachment upload/download through private object storage with authorization checks.
- Prove scheduled worker execution, idempotent provider retry, expired-lease recovery, and dead-letter alerting.
- Restore an encrypted backup into a separate target and verify migrations, row counts, constraints, and login revocation behavior.
- Confirm data residency, backup retention, recovery objectives, security ownership, incident response, support, and monthly cost.

## Decisions still requiring the owner

- Permitted hosting region and institutional data-residency rules.
- Budget range and preferred operational owner.
- Recovery point objective (acceptable data loss window) and recovery time objective (acceptable outage length).
- Identity/domain plan and the approved idempotent email provider.

Until those choices and staging evidence exist, there is deliberately no vendor recommendation and no production rollout.
