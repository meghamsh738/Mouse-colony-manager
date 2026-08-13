# Resume Checkpoint

Recorded: 2026-08-13

## Workspace

- Repository: `/Volumes/Coding Projects/Active/mouse-colony-manager`
- Authoritative worktree: `/Volumes/Coding Projects/Active/mouse-colony-manager/.runtime-data/worktrees/empty-colony`
- Branch: `codex/empty-colony`
- Primary tracker: `IMPLEMENTATION_TRACKER.md`
- Preserve this external-drive worktree. Do not reset, clean, or overwrite unrelated work.

## Practical State

- The Mouse Colony Manager's locally completable product milestones are finished and verified. Role-scoped workflows, the unit-wide privacy-safe Strain Directory, bounded inventories and histories, the scheduler-ready outbox worker, and the synthetic performance harness passed final review and acceptance on clean commit `a032202d09e6ccee0be1386b20aae9b93b7b3b89`.
- This does **not** mean the app is deployed to production. Hosting region, budget/operator, recovery objectives, institutional identity/domain, email provider, private object storage, and a synthetic staging candidate still require owner decisions.
- Milestone 9 production-shaped restore/cutover work is Deferred because the user has no real colony database. The guarded synthetic restore rehearsal remains available; do not request or invent production data.
- No retained migration was modified, no identifier trigger was bypassed, and no real colony data or external service was changed.
- The exact 10,000-animal load target is impossible under the reviewed four-digit facility identity contract (`0001`–`9999`). The verified boundary is 9,999 animals, which tests every valid facility animal ID without a risky contract expansion.

## Completed Milestone 10 Work

- Samples and Cryostorage use authorization-first database filtering, stable pages of 80 (maximum 100), narrow projections, and canonical out-of-range handling.
- Animal/cage histories are bounded to 50 records and scan notes to 15, with explicit truncation/fallback behavior.
- Cage and scan pages load bounded, server-searched/paginated transfer options only after an authorized operational user chooses **Move mouse**. Cage closure uses a same-lab destination-only read, missing-animal recovery is animal-authorized and same-lab scoped, and manual scan lookup stays in the authenticated App Router session.
- The one-shot outbox worker has bounded claims/concurrency/runtime, honest leases/retries/dead letters, topic-specific secrets, provider idempotency requirements, and privacy-safe System aggregates.
- The additive-only M10 load seed and runner enforce a dedicated loopback target and mode-restricted, sanitized artifacts outside the source worktree.
- The vendor-neutral hosting topology is recorded in `docs/HOSTING_DECISION.md`.

## Preserved Disposable Evidence

- PostgreSQL 16.14 remains loopback-only at `127.0.0.1:51422`, using the external runtime data directory.
- Final role/browser QA target: database `mcm_test_final_20260812_r1`, schema `mcm_test_final`.
- Load target: database `mcm_test_m10_load_20260812_r1`, schema `mcm_test_m10_load`; exact 9,999 animals, 2,000 cages, and 50 synthetic load identities (55 users including the base seed).
- Queue target: database `mcm_test_m10_queue_20260812_r1`, schema `mcm_test_m10_queue`; ten delivered synthetic notifications retained for review.
- Optimized diagnostic load artifact: `.runtime-data/m10-load/20260812-r1/2026-08-12T22-57-31-555Z`.
- Final clean-commit load artifact: `.runtime-data/m10-load/20260813-final/2026-08-13T00-09-41-235Z`.
- Queue artifact: `.runtime-data/m10-load/queue-probes/queue-probe-2026-08-12T22-20-55-990Z`.
- These targets and artifacts are synthetic and intentionally preserved. Do not reset or reuse them; create a fresh guarded target for a new run.

## Verification Evidence

- Node.js 22.23.1 production build: 51 generated application entries.
- Unit tests: 109 files / 513 tests.
- Guarded disposable-database tests: 8 files / 150 tests.
- Authorization manifest: 82 protected entry points.
- Focused load-harness tests: 12 passed; queue-probe tests: 6 passed.
- Clean-commit production load acceptance: 1,536 requests across 14 authenticated route types, observed concurrency 50, zero errors/writes/pool failures, p50 1.840 s, p95 3.764 s, 20.96 requests/s, RSS p95/max 2.202/2.298 GB, maximum 26 PostgreSQL connections with a 25-connection application pool, and 50,336 estimated application database calls.
- Queue probe: ten deliveries; queue-wait p50/p95 1,088/1,420 ms, service p50/p95 40/285 ms, end-to-end p50/p95 736/1,030 ms.
- Desktop/mobile Playwright role and workflow acceptance passed all 96 scenarios, covering every seeded role; background visual checks of the built dashboard and transfer workspace also passed at desktop and 412 x 915 with no horizontal overflow.
- TypeScript, Prisma validation, scoped/full lint with only five longstanding non-blocking administration warnings, production build, and diff checks passed.
- Final independent re-review returned CLEAR with no remaining P0/P1/P2 blockers after the cage-alert, bounded-transfer, missing-animal, pinned-destination, and outbox-behavior fixes.

## Safe Resume Order

1. Read this file, `IMPLEMENTATION_TRACKER.md`, `docs/HOSTING_DECISION.md`, `docs/M10_LOAD_TEST.md`, and `docs/OUTBOX_WORKER_RUNBOOK.md`.
2. Confirm the external drive, branch, and loopback PostgreSQL target before running anything. Never point destructive seeds or probes at a retained/shared/remote target.
3. If continuing local development, create a new uniquely named `mcm_test_*` database/schema instead of overwriting preserved evidence.
4. If preparing deployment, first obtain the owner decisions listed in the hosting record. Externalize attachment storage, configure a provider/scheduler/secret store, and run the identical synthetic snapshot three times in approved staging.
5. Do not select a hosting vendor/tier or call the app production-ready until object-storage authorization, worker recovery, encrypted backup restore, data residency, cost, and recovery objectives pass the staging gate.
6. When real colony data eventually exists, resume Milestone 9 through the documented sanitized production-shaped restore rehearsal; until then it remains Deferred.

## Safety Notes

- All destructive local tools must satisfy the repository's explicit `mcm_test_*`, loopback, matching-URL, non-production, and opt-in guards.
- Keep credentials, cookies, database URLs, SQL, record identifiers, lab names, scientific payloads, and provider bodies out of evidence artifacts.
- Preserve checked-in migrations and database audit/identity triggers.
- Local synthetic success informs capacity and architecture; it is not clinical, institutional, security, backup, or production approval.
