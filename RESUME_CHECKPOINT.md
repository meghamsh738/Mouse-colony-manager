# Resume Checkpoint

Recorded: 2026-07-18

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

- The implementation goal is paused, not complete or blocked.
- The disposable PostgreSQL server is running at `127.0.0.1:51422`; the application uses a webpack-mode development server at `127.0.0.1:3000` while active QA is in progress.
- The retained disposable verification schema is `mcm_test_administration_20260717_r66` on the local PostgreSQL cluster previously used at `127.0.0.1:51422`.
- The retained verification schema is currently not migrated or seeded after the laptop restart. Tenant policy requires the user to initiate the migration and destructive empty seed, even though it is loopback-only and uses the disposable `mcm_test_*` schema.

## Milestone Status

- **M8-05 Workbook:** verified and recorded in the tracker.
- **M8-06 Empty-instance onboarding:** independently reviewed and cleared after fixes, but its tracker row/evidence still needs to be updated to `Verified`.
  - Onboarding counts only active lab-user identities (canonical or legacy role) with an active membership in an active lab.
  - The rule editor Close/Cancel behavior was fixed after feedback.
  - Focused verification passed: 2 test files, 6 tests, typecheck, ESLint, and diff-check.
- **M8-07 Accessibility and responsive audit:** static checks and the independent review gate are complete; authenticated browser acceptance remains unfinished.
  - Mobile touch targets were improved across dashboard, rule editor, intake, animals, cages, labels, scan, and billing.
  - Dense cage detail tables are hidden in the mobile presentation.
  - `turbopack.root: process.cwd()` was added to `next.config.ts` after Next.js inferred the parent checkout and served the wrong stylesheet for the nested worktree.
  - Detail and scan views now independently scope manual alerts, health notes, attachments, occupants, and derived capacity to the cage lab. Mobile cage cards retain all operational metadata in the compact presentation.
  - Turbopack on Node 26 fans out during `/login` compilation; `npm run dev` now defaults to verified webpack mode. The login screen passed desktop and 390 x 844 mobile QA with no horizontal overflow or console errors. Final verification passed 90 unit files / 434 tests, typecheck, lint with five pre-existing warnings only, build (50 routes), Prisma validation, authorization-manifest validation (80 entries), and diff-check. Authenticated persona QA still requires a migrated and empty-seeded disposable schema.

## Last Successful Verification

- M8-05 full unit suite: 89 files, 432 tests passed.
- Production build passed with 50 routes before the latest M8-06/M8-07 changes.
- M8-06 focused tests, typecheck, ESLint, and diff-check passed.
- Independent M8-06 review returned `CLEAR`.

## Resume Order

1. Read `IMPLEMENTATION_TRACKER.md` and this checkpoint before editing.
2. Update M8-06 in the tracker to `Verified` with its evidence.
3. Ask the user to run the retained disposable-schema migration and empty seed commands recorded in the active task before any authenticated browser work.
4. Use `npm run dev` (webpack mode) for local browser QA; retain the Turbopack issue as a Node 26 runtime limitation rather than attempting to use it for this worktree.
5. Re-run M8-07 desktop and mobile browser QA with the correct worktree CSS across relevant personas and confirm no page-level overflow or clipped operational controls.
6. Mark M8-07 Verified only after the authenticated browser evidence is recorded; then begin Milestone 9 populated-data rehearsal with the documented backup, disposable-schema, and migration safeguards.

## Safety Notes

- Do not seed or migrate the populated database during resume setup.
- Destructive verification is allowed only in a disposable `mcm_test_*` schema.
- Keep PostgreSQL bound to loopback when local verification resumes.
- Do not mark the overall goal complete merely because Milestone 8 finishes; populated rollout and later tracker work remain.
