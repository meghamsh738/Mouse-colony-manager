# Colony Maintenance Tracker

Last updated: 2026-04-30

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
  - authenticated `/api/v1` integration routes for animals, cages, experiments, projects, samples, and export discovery, including audited external sample intake
  - in-app notification inbox with admin-editable delivery toggles for overdue genotypes, weaning, breeder age, welfare follow-up, and reservation drift
  - outbound notification digest preview and webhook delivery endpoint
  - quarantine and sentinel tracking workspace
  - richer experiment planner exclusion examples, randomization, and project-allocation risk
  - breeding generator warnings from allele-level harmful homozygous, het-only, pending genotype, and prohibited-pairing metadata
  - concrete HTTP email-provider notification delivery
  - breeding helper fertility-history scoring and surplus-risk estimates
  - experiment treatment-arm constraints for age-band balancing and same-cage group limits
  - provider deployment notes for HTTP email delivery
  - surplus-minimization forecast comparing planned demand against available and projected supply
  - facility-configurable fertility-history and surplus scoring rules
  - line-specific fertility models for strain productivity differences
  - configurable longer-range study demand forecasting

- Working, but still rough:
  - e2e reliability now depends on per-test reseeding, which is correct but slow; repeated local runs can now reuse an already-started e2e server to avoid rebuilding each time
  - Prisma local dev DB remains the main source of flaky local verification if `prisma dev` drops; `npm run db:doctor` now fails fast with endpoint and PostgreSQL startup-protocol status, and local e2e prep uses the direct database URL
  - attachment persistence is local-disk backed under `public/uploads` for MVP, not object storage
  - outbound email uses a generic HTTP provider contract; production deployment still needs real provider URL and token configuration

- Still missing relative to the original blueprint:
  - broader external integration API beyond the current sample intake, read-mostly `/api/v1`, CSV export endpoints, and notification delivery preview/webhook surface

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
- [x] Add an in-app notification inbox with rule-config toggles for overdue genotypes, weaning, breeder age, welfare follow-up, and reservation drift
- [x] Add outbound notification digest preview and webhook delivery plumbing
- [x] Add quarantine and sentinel tracking from quarantine cages, unresolved health notes, welfare flags, movement history, and configurable thresholds
- [x] Deepen experiment planning with exclusion examples and multi-project or missing-project allocation awareness
- [x] Deepen breeding generator warnings with allele-level harmful homozygous, het-only maintenance, pending genotype, and prohibited-pairing metadata
- [x] Add concrete HTTP email-provider delivery for notification digests
- [x] Add breeder fertility-history scoring, workload penalties, expected litter size, and surplus-risk estimates
- [x] Add treatment-arm constraints for age-band balancing and same-cage group limits
- [x] Add provider-specific deployment documentation for production email delivery
- [x] Add surplus-minimization forecasting across planned studies and active breedings
- [x] Add facility-specific fertility-history settings to tune breeding helper penalties
- [x] Add line-specific fertility models for strains with known productivity differences
- [x] Add longer-range study demand forecasting beyond the current short-horizon planner
- [x] Add a reusable local Playwright verification path for repeated e2e checks
- [x] Add a read-only Prisma dev DB doctor and direct local prep path for WSL/local setup failures
- [x] Add an audited external sample intake API under `/api/v1/samples`

## In Progress

- [ ] Keep the tracker current as new slices land

## Next

- [ ] Define the next external write integration after sample intake, likely genotype result intake or experiment assignment sync

## Verification Snapshot

Most recently verified in this branch:

- `npm run prisma:validate`
- `npm run typecheck`
- `npx vitest run tests/unit/db-doctor.test.ts --reporter=verbose`
- `npx vitest run tests/unit/db-prepare-local.test.ts --reporter=verbose`
- `npx vitest run tests/unit/integration-api-routes.test.ts --reporter=verbose`
- `npm run db:doctor`
- `npm run db:prepare:local`
- `npx vitest run tests/unit/colony.test.ts -t 'ranks breeding suggestions|builds a live colony forecast' --reporter=verbose`
- `npm run e2e:server`
- `npm run verify:e2e:reuse:wsl -- --grep 'researcher can query the authenticated integration API surface' --project=chromium`
- `npm run verify:e2e:reuse:wsl -- --grep 'seeded user can log in and reach the dashboard' --project=chromium`
- `npm run verify:e2e:wsl -- --grep 'admin can review breeding overview and generator suggestions|researcher can review the forecast workspace'`
- `npm run verify:e2e:wsl -- --grep 'researcher can review the forecast workspace'`
- `git diff --check`
- `npm run build` via the targeted Playwright web-server bootstrap
- `npx vitest run tests/unit/notification-delivery.test.ts --reporter=verbose`
- `npx vitest run tests/unit/quarantine-read.test.ts --reporter=verbose`
- `npx vitest run tests/unit/colony.test.ts -t 'ranks breeding suggestions|evaluates harmful|builds a filtered experiment planner' --reporter=verbose`
- `npm run verify:e2e:wsl -- --grep 'researcher can review experiment overview and tune the distribution helper|admin can review breeding overview and generator suggestions'`
- `npm run verify:e2e:wsl -- --grep 'researcher can review experiment overview and tune the distribution helper|admin can review breeding overview and generator suggestions|staff can review quarantine and sentinel tracking'`
- `npx vitest run tests/unit/colony.test.ts -t 'adds a cage health note that surfaces as a cage alert|records a genotype result and updates the animal detail genotype views' --reporter=verbose`
- `npx vitest run tests/unit/integration-api-routes.test.ts --reporter=verbose`
- `npx vitest run tests/unit/notifications-read.test.ts --reporter=verbose`
- `npm run verify:e2e:wsl -- --grep 'staff can review the notification inbox and jump into breeding follow-up'`
- `npm run verify:e2e:wsl -- --grep 'researcher can query the authenticated integration API surface'`
- `npm run verify:e2e:wsl -- --grep '(animal staff can scan a cage and log a welfare note|admin can record a genotype result from the animal detail page)'`
- `npm run verify:e2e:wsl -- --grep 'researcher can review experiment overview and tune the distribution helper'`
- `npm run verify:e2e:wsl -- tests/e2e/smoke.spec.ts`

Notes:

- On 2026-04-26, `localhost:51214` initially had no listener and `npx prisma dev -d -n colony-maintenance` stalled in this WSL/mounted-workspace session; the listener later recovered and the targeted DB-backed unit and e2e checks above passed.
- On 2026-04-30, reusable Playwright verification was added through `E2E_REUSE_EXISTING_SERVER=1`; keep `npm run e2e:server` running in another shell for repeated local checks.
- On 2026-04-30, `npm run db:doctor` was added as a read-only preflight for `DATABASE_URL` and `DIRECT_DATABASE_URL`; it reports the configured host, port, database, TCP reachability, and PostgreSQL startup-protocol status before expensive verification starts.
- On 2026-04-30, local e2e server bootstrap switched to reseed-only startup to avoid repeated `prisma db push` cost and prepared-statement failures; use `db:prepare:local` explicitly after first setup, schema changes, or DB reset.
- On 2026-04-30, `/api/v1/samples` was added for external sample inventory integrations, with filtered sample reads, audited POST intake, idempotent duplicate handling for the same animal, and read-only role rejection.
- The latest notification delivery unit suite covers webhook delivery and HTTP email-provider delivery with a mocked provider endpoint.
- The latest breeding and forecast smoke checks passed on both Playwright `chromium` and `mobile` projects after adding line-specific fertility models and configurable long-range runway forecasting.
- The latest targeted colony unit coverage checks breeding line-fertility output and long-range forecast summary fields.
- The latest experiment and breeding smoke checks passed on both Playwright `chromium` and `mobile` projects after adding age-band treatment-arm constraints and fertility/surplus helper output.
- The latest forecast smoke passed on both Playwright `chromium` and `mobile` after adding surplus-minimization demand/supply panels.
- Targeted unit coverage, build, and attachment-specific desktop/mobile smoke flows passed after the attachment slice landed.
- The notification inbox read model passed unit coverage, and the `/notifications` inbox smoke passed across both Playwright projects after switching the follow-up assertion to href-based navigation for mobile stability.
- The authenticated `/api/v1` smoke check passed across both Playwright projects after trimming it to a stable list-and-export request path; the detail route is covered in the unit suite.
- Full-repo `npm run lint` still hangs on the mounted `D:` workspace in this WSL setup, so it is not part of the latest verified snapshot.
- Earlier full smoke coverage also passed across both Playwright projects in this branch.
- I did not rerun the full `npm run verify` bundle in the latest tracker update turn.
