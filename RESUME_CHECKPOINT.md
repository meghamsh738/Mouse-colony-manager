# Resume Checkpoint

Recorded: 2026-08-10

## Workspace

- Repository: `/Volumes/Coding Projects/Active/mouse-colony-manager`
- Authoritative worktree: `/Volumes/Coding Projects/Active/mouse-colony-manager/.runtime-data/worktrees/empty-colony`
- Branch: `codex/empty-colony`
- Primary tracker: `IMPLEMENTATION_TRACKER.md`
- Preserve this external-drive worktree. Do not reset, clean, or overwrite unrelated uncommitted work.

## Current State

- Milestones 8 and the bounded Unit-wide Strain Directory slice are verified in the tracker.
- The optional production-shaped M9 restore rehearsal is deferred because no real colony database exists yet. Do not request or handle production data until the user has real data and approves the documented controls.
- Milestone 10 performance work is active.
- M10-01 Animals slice is complete: authorization-scoped PostgreSQL search/filtering, stable server pagination (80 rows by default, hard maximum 100), canonical out-of-range redirects, filter-preserving CSV export, and desktop/mobile coverage.
- M10-01 remains **In progress** because cages, biosamples, cryostorage, and bounded relationship/detail histories are still open.
- M10-02 and M10-03 retain their earlier safe first passes. M10-04 through M10-07 remain open.
- No schema migration, persistent cache, production service, real colony data, or hosting decision changed in the Animals slice.

## Disposable QA Runtime

- PostgreSQL 16 is configured on loopback `127.0.0.1:51422` with data directory `/Volumes/Coding Projects/Active/mouse-colony-manager/.runtime-data/qa-empty-colony-20260726/postgres16-m8-qa`.
- The current disposable database is `mcm_test_role_qa_20260808_r1`, schema `mcm_test_role_qa`.
- Readback at this checkpoint: 36 completed migrations, 5 synthetic users, 3 synthetic labs, 14 synthetic animals, and 5 synthetic cages.
- This is synthetic example data only. Guarded destructive reseeding is allowed only with the existing disposable-target checks and explicit `ALLOW_DESTRUCTIVE_SEED=true`.
- The temporary production-mode QA app on port `3012` and PostgreSQL server are stopped after validation. Restart them only when needed.

## Last Successful Verification

- Focused Animals query/privacy tests: 5 passed.
- Full unit suite: 100 files / 464 tests passed.
- Guarded disposable-database suite: 8 files / 148 tests passed.
- Complete Playwright smoke suite: 78 scenarios passed (39 desktop and 39 mobile).
- TypeScript, Prisma validation, production build (51 pages), and `git diff --check` passed.
- ESLint passed with zero errors and five unchanged warnings in `src/app/administration/labs/actions.ts`.
- Manual final diff review found no blocking issue. Independent subagent review was unavailable under the active no-delegation constraint.

## Resume Order

1. Read this file and `IMPLEMENTATION_TRACKER.md`; confirm the branch and worktree are clean before editing.
2. Confirm the external drive and PostgreSQL data directory are present before starting the disposable runtime.
3. Continue M10-01 with one bounded inventory/history surface at a time; cages are the natural next inventory candidate.
4. Preserve authorization-first filtering and intentional full-list API/Workbook consumers unless their contracts are separately redesigned.
5. Run focused tests, full unit/database gates as appropriate, production build, and desktop/mobile QA before committing each slice.
6. Keep the production-shaped M9 rehearsal deferred until real data exists and the user explicitly approves its encryption, retention, access, and artifact-location controls.

## Safety Notes

- Never point destructive verification at a database or schema that does not satisfy the repository's disposable `mcm_test_*` guards.
- Keep PostgreSQL bound to loopback for local QA.
- Do not alter retained migrations or real colony data.
- Do not infer production readiness from synthetic QA, and do not select hosting until M10 load measurements are recorded.
