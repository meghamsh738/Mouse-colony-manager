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
- The webpack-mode QA server runs from the disposable runtime mirror at `http://localhost:3000` while active QA is in progress.

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

## Last Successful Verification

- M8-05 full unit suite: 89 files, 432 tests passed.
- M8-07 full gate passed 90 unit files / 434 tests, typecheck, lint with five pre-existing warnings, production build with 50 routes, Prisma validation, authorization-manifest validation with 80 entries, and `git diff --check`.
- M8-06 focused tests, typecheck, ESLint, and diff-check passed.
- Independent M8-06 review returned `CLEAR`.
- M8-07 authenticated persona and responsive acceptance passed against the empty-seeded disposable PostgreSQL 16 schema.
- The focused billing touch-target retest measured Overview 59 x 44 px, Rates 44 x 44 px, and Invoices 49 x 44 px with zero document overflow.
- Typecheck and `git diff --check` passed after the billing touch-target correction and evidence update.
- The final focused diff review returned `CLEAR` with no blocking finding.

## Resume Order

1. Read `IMPLEMENTATION_TRACKER.md` and this checkpoint before editing.
2. Review and commit the M8-07 evidence plus the billing tab touch-target correction if they remain uncommitted.
3. Begin Milestone 9 populated-data rehearsal only with the documented backup, disposable-schema, migration, and rollback safeguards.
4. Keep populated data separate from the M8 empty-instance schema and never point destructive verification at a non-`mcm_test_*` schema.
5. Retain webpack mode and Node 22 for local browser QA until the Node 26 Turbopack worker issue is resolved independently.

## Safety Notes

- Do not seed or migrate the populated database during resume setup.
- Destructive verification is allowed only in a disposable `mcm_test_*` schema.
- Keep PostgreSQL bound to loopback when local verification resumes.
- Do not mark the overall goal complete merely because Milestone 8 finishes; populated rollout and later tracker work remain.
