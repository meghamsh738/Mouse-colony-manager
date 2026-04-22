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

- Working, but still rough:
  - e2e reliability now depends on per-test reseeding, which is correct but slow
  - Prisma local dev DB remains the main source of flaky local verification if `prisma dev` drops
  - README status text is behind the actual implemented write surface

- Still missing relative to the original blueprint:
  - attachment upload flows for gels, PDFs, and health/genotype documents
  - notifications and delivery channels
  - external integration API beyond auth and CSV export endpoints
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

## In Progress

- [ ] Keep the tracker current as new slices land
- [ ] Bring README implementation notes back in sync with the current runtime

## Next

- [ ] Add attachment upload and viewing for genotype reports, gel images, PDFs, and health documents
- [ ] Expose attachment history on animal, cage, and genotype views
- [ ] Add a small integration API surface for core entities and operational exports
- [ ] Add notification plumbing for overdue genotypes, weaning, breeder age, welfare flags, and reservation drift
- [ ] Add quarantine / sentinel tracking if it is still in scope for MVP+
- [ ] Deepen experiment planning with richer exclusion summaries, balancing controls, and multi-project allocation awareness
- [ ] Deepen breeding rule configuration and harmful/prohibited genotype enforcement in the planner UI
- [ ] Improve local verification speed by reducing the cost of the Playwright web-server bootstrap
- [ ] Make the local Prisma dev DB setup more resilient or documented so `verify` is less fragile on WSL

## Verification Snapshot

Most recently verified in this branch:

- `npm run typecheck`
- `npm run verify:e2e:wsl -- --grep 'researcher can review experiment overview and tune the distribution helper'`
- `npm run verify:e2e:wsl -- tests/e2e/smoke.spec.ts`

Notes:

- Full smoke coverage passed across both Playwright projects in the current branch.
- I did not rerun the full `npm run verify` bundle in the latest tracker update turn.
