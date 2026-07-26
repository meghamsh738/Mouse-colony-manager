# Resume Checkpoint

Recorded: 2026-07-26

## Workspace

- Repository: `/Volumes/Coding Projects/Active/mouse-colony-manager`
- Active implementation worktree: `/Volumes/Coding Projects/Active/mouse-colony-manager/.runtime-data/worktrees/empty-colony`
- Branch: `codex/empty-colony`
- Expected migration commit: `fa251e9ffe663aaf61a356e338b898f2acebac3e`
- Primary tracker: `IMPLEMENTATION_TRACKER.md`
- The previously large dirty state was preserved in the migration commit and the
  external worktree is expected to be clean. Do not reset, clean, or revert
  unrelated files.

## Paused State

- The implementation goal continues with Milestone 9; it is not complete or blocked.
- The authoritative source remains the external-drive worktree above. A disposable exact-HEAD runtime mirror at `/private/tmp/mcm-empty-colony-runtime` is used only to avoid external-drive development-server latency; do not treat it as source.
- A dedicated PostgreSQL 16 cluster is bound to loopback at `127.0.0.1:51422`. Its data directory is `/Volumes/Coding Projects/Active/mouse-colony-manager/.runtime-data/qa-empty-colony-20260726/postgres16-m8-qa`.
- Disposable schema `mcm_test_administration_20260717_r66` has all 35 migrations and the guarded empty seed. Readback: five users, two labs, two memberships, zero cages, and zero animals.
- The M8 empty-instance schema remains separate and was not modified by the M9 rehearsal.
- Disposable M9 source database `mcm_test_m9_source_20260726_r1` and restore database `mcm_test_m9_restore_20260726_r1` use schema `mcm_test_populated`; the source is database-level read-only and the target contains the verified restored fixture.
- The webpack-mode QA server used for restored-app verification has been stopped.

## Milestone Status

- **M8-05 Workbook:** verified and recorded in the tracker.
- **M8-06 Empty-instance onboarding:** verified and recorded in the tracker.
  - Onboarding counts only active lab-user identities (canonical or legacy role) with an active membership in an active lab.
  - The rule editor Close/Cancel behavior was fixed after feedback.
  - Focused verification passed: 2 test files, 6 tests, typecheck, ESLint, and diff-check.
- **M8-07 Accessibility and responsive audit:** verified and recorded in the tracker.
  - Mobile touch targets were improved across dashboard, rule editor, intake, animals, cages, labels, scan, and billing.
  - Dense cage detail tables are hidden in the mobile presentation.
  - `turbopack.root: process.cwd()` was added to `next.config.ts` after Next.js inferred the parent checkout and served the wrong stylesheet for the nested worktree.
  - Detail and scan views now independently scope manual alerts, health notes, attachments, occupants, and derived capacity to the cage lab. Mobile cage cards retain all operational metadata in the compact presentation.
  - Turbopack on Node 26 fans out during `/login` compilation; `npm run dev` defaults to verified webpack mode. The login screen passed desktop and 390 x 844 mobile QA with no horizontal overflow or console errors. Final verification passed 90 unit files / 434 tests, typecheck, lint with five pre-existing warnings only, build (50 routes), Prisma validation, authorization-manifest validation (80 entries), and diff-check.
  - Authenticated desktop and 390 x 844 QA covered Facility Admin, CMU Staff, Lab User 1, and IT Head access boundaries. Tested pages had zero document overflow, denied pages exposed no protected domain fields, and representative phone controls measured at least 44 px after correcting the billing Rates tab minimum width.
- **M9-01 Production-shaped backup restore:** in progress; the synthetic mechanics slice is implemented and integration-verified, while the production-shaped-data gate remains open.
  - Additive-only disposable fixture seeding succeeded without reset/delete/update/upsert behavior.
  - Guarded run `m9-backup-2026-07-26T21-22-52-730Z-38145` verified an atomic PostgreSQL 16.14 restore with exact parity across 75 tables, 44 rows, and 35 migrations.
  - Manifest: `/Volumes/Coding Projects/Active/mouse-colony-manager/.runtime-data/m9-rehearsals/m9-backup-2026-07-26T21-22-52-730Z-38145/manifest.json`.
  - Authenticated desktop and 390 x 844 smoke QA passed against the restored database, including the restored `M9 Synthetic Lab`; tested pages had zero document overflow and the mobile presentation had no visible tables or sub-44 px controls.

## Last Successful Verification

- M8-05 full unit suite: 89 files, 432 tests passed.
- M8-07 full gate passed 90 unit files / 434 tests, typecheck, lint with five pre-existing warnings, production build with 50 routes, Prisma validation, authorization-manifest validation with 80 entries, and `git diff --check`.
- M8-06 focused tests, typecheck, ESLint, and diff-check passed.
- Independent M8-06 review returned `CLEAR`.
- M8-07 authenticated persona and responsive acceptance passed against the empty-seeded disposable PostgreSQL 16 schema.
- The focused billing touch-target retest measured Overview 59 x 44 px, Rates 44 x 44 px, and Invoices 49 x 44 px with zero document overflow.
- Typecheck and `git diff --check` passed after the billing touch-target correction and evidence update.
- The final focused diff review returned `CLEAR` with no blocking finding.
- M9 synthetic backup/restore integration verified a 613,490-byte custom archive (SHA-256 `7e544c065532406a19c15ad122f1a3850dd9d657749a54bbb9a8847df2a4a77d`) and a 433,868-byte schema artifact (SHA-256 `9b663f8c2217d64914344baedcdd9c5c6c54ff58a4a2769966186f25504121b1`); backup took 222 ms and restore took 3,129 ms.
- Restored Prisma migration status reported all 35 migrations current. The restore database remained writable and recorded one browser-QA security event.
- M9 synthetic-slice validation passed 92 unit files / 444 tests, focused seed/harness workflow tests (3 files / 18 tests), typecheck, scoped ESLint, Prisma validation, retained-data workflow validation, production build with 50 routes, and `git diff --check`.
- A procedure wiring unit test now pins its clock because its fixed July 20 future-schedule fixture expired on July 26; the full suite passes after that time-dependence correction.
- Independent high-risk review returned `CLEAR` with no P0/P1/P2 blockers after the seed checks/inserts were made atomic and the runbook was bound explicitly to the source database.

## Resume Order

1. Read `IMPLEMENTATION_TRACKER.md` and this checkpoint before editing.
2. Preserve the completed synthetic M9-01 evidence and keep its source database frozen read-only.
3. Obtain explicit authorization and settle encryption, retention, access control, and artifact-location policy before handling any sanitized production-shaped backup.
4. Continue M9-01 with a production-shaped rehearsal only after those prerequisites are satisfied; do not treat the synthetic run as closing the gate.
5. Keep populated data separate from the M8 empty-instance schema and never point destructive verification at a non-`mcm_test_*` schema.
6. Retain webpack mode and Node 22 for local browser QA until the Node 26 Turbopack worker issue is resolved independently.

## Safety Notes

- Do not reseed, reset, or migrate either retained M9 rehearsal database during resume setup.
- Destructive verification is allowed only in a disposable `mcm_test_*` schema.
- Keep PostgreSQL bound to loopback when local verification resumes.
- Do not access a production-shaped backup without explicit authorization and an approved encryption, retention, access-control, and artifact-location policy.
- Do not mark the overall goal complete merely because Milestone 8 finishes; populated rollout and later tracker work remain.
