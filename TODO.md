# Colony Maintenance Tracker

Last updated: 2026-04-22

## Overall Status

The app is now a real Next.js + Prisma + PostgreSQL runtime rather than a demo-store app. Core colony workflows are live, Prisma-backed, and covered by unit tests plus Playwright smoke coverage on desktop and mobile.

Current delivery level:

- Done for MVP-level runtime use:
  - auth and role-gated app shell
  - dashboard summaries
  - animal list and animal detail
  - cage list, cage detail, QR lookup, and scan workspace
  - health notes and cage moves
  - breeding setup, litter logging, and weaning
  - genotype recording and CSV genotype import
  - experiment planner, planning, promotion, rollback, and reservation conflict handling
  - sample inventory
  - cryostorage inventory
  - forecast workspace
  - rules/settings and audit visibility
  - CSV exports
  - local attachment upload and viewing for genotype and welfare records
  - authenticated read-only `/api/v1` integration routes for animals, cages, experiments, projects, and export discovery

- Working, but still rough:
  - e2e reliability now depends on per-test reseeding, which is correct but slow
  - Prisma local dev DB remains the main source of flaky local verification if `prisma dev` drops
  - README status text is behind the actual implemented write surface
  - attachment persistence is local-disk backed under `public/uploads` for MVP, not object storage

- Still missing relative to the original blueprint:
  - notifications and delivery channels
  - external integration API beyond the current read-only `/api/v1` surface and CSV export endpoints
  - quarantine / sentinel workflows
  - advanced planner features such as randomization depth beyond current seeded balancing, richer experiment distribution controls, and more breeding rule depth

## Done

- [x] Replace persisted demo-store behavior with Prisma/PostgreSQL-backed reads and writes
- [x] Add role-based sign-in with seeded dev users
- [x] Ship animals, cages, scan, breeding, experiments, samples, cryostorage, forecast, and settings workspaces
- [x] Support animal creation, cage notes, cage moves, breeding setup, litter creation, weaning, genotype recording, genotype CSV import, lifecycle changes, rules updates, sample records, and cryostorage records
- [x] Add experiment cohort planning, planned assignment persistence, planned assignment editing, cohort promotion, cohort rollback, and assignment provenance in the UI
- [x] Add audit logging to core transactional write flows
- [x] Add CSV exports and export auth protection
- [x] Stabilize Playwright smoke runs across `chromium` and `mobile` by reseeding before each test
- [x] Extract reusable seeding into `prisma/seed-database.ts`
- [x] Add local attachment upload and viewing for genotype records and cage health notes
- [x] Add authenticated `/api/v1` read-only integration routes for core colony entities and export discovery

## In Progress

- [ ] Keep the tracker current as new slices land
- [ ] Bring README implementation notes back in sync with the current runtime

## Next

- [ ] Add notification plumbing for overdue genotypes, weaning, breeder age, welfare flags, and reservation drift
- [ ] Add quarantine / sentinel tracking if it is still in scope for MVP+
- [ ] Deepen experiment planning with richer exclusion summaries, balancing controls, and multi-project allocation awareness
- [ ] Deepen breeding rule configuration and harmful/prohibited genotype enforcement in the planner UI
- [ ] Improve local verification speed by reducing the cost of the Playwright web-server bootstrap
- [ ] Make the local Prisma dev DB setup more resilient or documented so `verify` is less fragile on WSL

## Verification Snapshot

Most recently verified in this branch:

- `npm run typecheck`
- `npm run build`
- `npx vitest run tests/unit/colony.test.ts -t 'adds a cage health note that surfaces as a cage alert|records a genotype result and updates the animal detail genotype views' --reporter=verbose`
- `npx vitest run tests/unit/integration-api-routes.test.ts --reporter=verbose`
- `npm run verify:e2e:wsl -- --grep 'researcher can query the authenticated integration API surface'`
- `npm run verify:e2e:wsl -- --grep '(animal staff can scan a cage and log a welfare note|admin can record a genotype result from the animal detail page)'`
- `npm run verify:e2e:wsl -- --grep 'researcher can review experiment overview and tune the distribution helper'`
- `npm run verify:e2e:wsl -- tests/e2e/smoke.spec.ts`

Notes:

- Targeted unit coverage, build, and attachment-specific desktop/mobile smoke flows passed after the attachment slice landed.
- The authenticated `/api/v1` smoke check passed across both Playwright projects after trimming it to a stable list-and-export request path; the detail route is covered in the unit suite.
- Full-repo `npm run lint` still hangs on the mounted `D:` workspace in this WSL setup, so it is not part of the latest verified snapshot.
- Earlier full smoke coverage also passed across both Playwright projects in this branch.
- I did not rerun the full `npm run verify` bundle in the latest tracker update turn.
