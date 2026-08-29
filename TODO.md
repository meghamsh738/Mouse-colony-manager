# Legacy Colony Maintenance Tracker (Historical)

> **Historical record only.** This file captures the pre-role-redesign implementation log as it stood in May 2026. Its “In Progress” and “Next” sections are not current work instructions. Use [`IMPLEMENTATION_TRACKER.md`](./IMPLEMENTATION_TRACKER.md) for current milestone status and [`docs/PRODUCT_READINESS_REMEDIATION.md`](./docs/PRODUCT_READINESS_REMEDIATION.md) for the approved Pro-review roadmap.

Last updated: 2026-05-18

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
  - authenticated `/api/v1` integration routes for animals, cages, breeding setup intake, litter intake, weaning sync, experiments, projects, samples, genotype intake, experiment assignment sync, cage welfare event intake, and export discovery, including audited external animal intake, project catalog sync, sample intake, sample lifecycle updates, genotype result intake, breeding setup intake, litter intake, weaning sync, planned-assignment intake, assignment promote/rollback status sync, and cage health-note ingestion
  - cohesive production UI redesign across dashboard, animals, cages, scan, breeding, experiments, forecast, samples, cryostorage, quarantine, notifications, and settings
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
  - repeated local Playwright reseeds against a reused production server can still close the app server's Prisma connection; if an error boundary appears after several seeded tests, rerun `npm run db:doctor` and restart only the app server before retrying the failed smoke
  - attachment persistence is local-disk backed under `public/uploads` for MVP, not object storage
  - outbound email uses a generic HTTP provider contract; production deployment still needs real provider URL and token configuration

- Still missing relative to the original blueprint:
  - broader external integration API beyond current project/sample/genotype/experiment-assignment/cage-welfare intake and status sync, read-mostly `/api/v1`, CSV export endpoints, and notification delivery preview/webhook surface

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
- [x] Add audited external sample lifecycle update API under `/api/v1/samples`
- [x] Add audited external cryostorage intake and lifecycle update API under `/api/v1/cryostorage`
- [x] Add audited external animal terminal lifecycle sync under `/api/v1/animals`
- [x] Add audited external animal intake under `/api/v1/animals`
- [x] Add audited external cage move sync under `/api/v1/cages`
- [x] Add audited external cage welfare/equipment event intake under `/api/v1/cages/health-notes`
- [x] Add audited external breeding setup intake under `/api/v1/breeding-setups`
- [x] Add audited external litter intake under `/api/v1/litters`
- [x] Add audited external weaning sync under `/api/v1/weanings`
- [x] Add an audited external genotype result intake API under `/api/v1/genotypes`
- [x] Add multipart attachment/document handoff support to genotype and cage-welfare integration intake routes
- [x] Add an audited external planned experiment assignment sync API under `/api/v1/experiments/assignments`
- [x] Add audited external experiment assignment promote/rollback status sync under `/api/v1/experiments/assignments`
- [x] Add audited external planned assignment detail maintenance under `/api/v1/experiments/assignments/{assignmentId}`
- [x] Add audited external direct experiment reservation sync under `/api/v1/experiments/reservations`
- [x] Add audited admin rule config sync under `/api/v1/rules`
- [x] Add audited bulk genotype CSV import under `/api/v1/genotypes/import`
- [x] Add audited external project catalog sync under `/api/v1/projects`
- [x] Redesign the app UI from GPT image-inspired direction into one cohesive desktop/mobile visual system with responsive table cards and route-level screenshot audits
- [x] Simplify the app shell and inventory/breeding workspaces with compact navigation, table-first layouts, consistent badges, readable rule values, and desktop/mobile overflow audits
- [x] Extend the desktop navigation rail to a fixed full-height panel and switch app typography to IBM Plex Sans for a more professional product feel
- [x] Stress-test the redesigned app with 1,000 generated animals plus browser-driven planner, scan, sample, breeding, cryostorage, audit, and read-only flows; fix wildcard-host scan lookup redirects exposed by the run
- [x] Optimize high-volume navigation by replacing full dashboard recomputation in the shared shell, rendering heavy list workspaces in bounded batches, deferring table search filtering, and capping breeding suggestion pair scoring
- [x] Add contextual question-mark help to every desktop and mobile navigation tab
- [x] Tighten module space usage with adaptive stat strips and a split scan workspace instead of an empty camera panel

## In Progress

- [ ] Keep the tracker current as new slices land

## Next

- [ ] Define the next external write integration after project catalog sync, animal intake, breeding setup intake, litter intake, weaning sync, animal lifecycle, cage moves, sample, cryostorage, genotype single-result intake, genotype CSV import, attachment-aware cage welfare intake, experiment assignment sync/status/detail maintenance, direct experiment reservation sync, and admin rule config sync

## Verification Snapshot

Most recently verified in this branch:

- 2026-05-18 project catalog API slice: `npm run db:doctor`, `npm run db:prepare:local`, `npx vitest run tests/unit/integration-api-routes.test.ts -t "integration index|project" --reporter=verbose`, `npm run prisma:validate`, `npm run typecheck`, `git diff --check`, `npm run build`, and `E2E_BASE_URL=http://localhost:3005 npm run verify:e2e:reuse:wsl -- --grep 'researcher can query the authenticated integration API surface' --project=chromium`
- 2026-05-18 current batch landing gate: `npm run prisma:validate`, `npm run typecheck`, `git diff --check`, `npm run db:doctor`, `npm run build`, `npx vitest run tests/unit/rule-config.test.ts --reporter=verbose`, and `npx vitest run tests/unit/scan-lookup-route.test.ts --reporter=verbose`
- 2026-05-18 Playwright browser confidence audit against `http://localhost:3005`: desktop route sweep across dashboard, animals, cages, breeding, experiments, samples, cryostorage, forecast, notifications, quarantine, scan, and settings at `1440x1000`; focused mobile checks for dashboard navigation, forecast, and scan at `390x844`; screenshots/report under `output/playwright/current-batch-audit`; confirmed zero horizontal overflow, zero unexpected overlap detections, and no clipped mobile nav links
- `npm run prisma:validate`
- `npm run typecheck`
- `git diff --check`
- `npm run db:doctor`
- `npm run build`
- `npx vitest run tests/unit/colony.test.ts -t 'ranks breeding suggestions|builds experiment overview and candidate reads|builds a live colony forecast' --reporter=verbose`
- Playwright CLI high-volume navigation audit with dataset token `FAST510`: dashboard `7567ms`, colony `3212ms`, cages `1670ms`, breeding `3707ms`, experiments `2078ms`, samples `1732ms`, cryostorage `553ms`, forecast `3607ms`, settings `562ms`, with zero horizontal overflow and list routes initially rendering `80` rows/cards instead of the full high-volume dataset
- `npx vitest run tests/unit/scan-lookup-route.test.ts --reporter=verbose`
- `npm run build`
- `curl -sI -H 'Host: 0.0.0.0:3005' 'http://127.0.0.1:3005/scan/lookup?barcode=CM-A101-003'` confirmed the rebuilt server redirects to `http://localhost:3005/scan/CM-A101-003`
- Playwright CLI stress run with dataset token `SOZVLFZD`: route sweep across `/`, `/animals`, `/cages`, `/breeding`, `/experiments`, `/samples`, `/cryostorage`, `/forecast`, `/notifications`, `/quarantine`, `/scan`, and `/settings`; user-like admin/researcher/staff/read-only flows for animal creation, breeding setup, cage note, sample record, planner save, cryostorage creation, audit review, and large-table search
- Sequential DB validation after the stress run: `1015` animals, `85` cages, `304` sample records, `156` health notes, `14` breeding setups, `4` cryostorage records, and `15` experiment assignments
- `npm run typecheck`
- `npm run build`
- Playwright CLI sidebar/font audit confirming the desktop rail is `position: fixed`, spans the full viewport before and after page scroll, has zero visible scrollbar width, and uses IBM Plex Sans
- `npx vitest run tests/unit/rule-config.test.ts --reporter=verbose`
- `git diff --check`
- `E2E_BASE_URL=http://localhost:3005 npm run verify:e2e:reuse:wsl -- --grep 'admin can review breeding overview and generator suggestions|researcher can review the forecast workspace' --project=chromium`
- Playwright CLI desktop/mobile route-wide visual audit across `/`, `/animals`, `/cages`, `/breeding`, `/experiments`, `/samples`, `/cryostorage`, `/forecast`, `/notifications`, `/quarantine`, `/scan`, and `/settings` with zero horizontal overflow, zero detected overlaps, and no clipped mobile nav links
- `npm run prisma:validate`
- `npm run typecheck`
- `git diff --check`
- `npm run build`
- `npm run db:prepare:local`
- `npm run db:doctor`
- `npm run typecheck`
- `git diff --check`
- `npm run build`
- Playwright CLI navigation-help audit against `http://127.0.0.1:3005`: confirmed `12` desktop and `12` mobile question-mark help triggers, readable desktop/mobile tooltips, minimum mobile tooltip width, and no tooltip viewport overflow; screenshots saved under `output/playwright/nav-help-desktop.png` and `output/playwright/nav-help-mobile.png`
- Playwright CLI before-screenshot sweep across dashboard, animals, cages, breeding, experiments, samples, cryostorage, forecast, notifications, quarantine, scan, and settings under `output/playwright/space-audit-before`
- `npm run typecheck`
- `git diff --check`
- `npm run build`
- Playwright CLI final space audit under `output/playwright/space-audit-final`: checked dashboard, forecast, scan, animals, and settings at `1440x1000`, `1920x1080`, and `390x844`; confirmed zero horizontal overflow, full content width except normal page padding, forecast stat strip stays one row at desktop widths, and scan exposes manual lookup, high-attention cage shortcuts, and camera-preview guidance instead of an empty panel
- Playwright CLI final all-module desktop audit under `output/playwright/space-audit-final-all`: captured dashboard, animals, cages, breeding, experiments, samples, cryostorage, forecast, notifications, quarantine, scan, and settings at `1440x1000` and `1920x1080`; confirmed zero horizontal overflow, full content width except normal page padding, and one-row desktop stat strips where stat strips are present
- GPT image inspiration artifact: `output/playwright/ui-inspiration/13-generated-ui-inspiration-board.png`
- Desktop/mobile visual route audit screenshots and report: `output/playwright/ui-final-audit/route-audit-report.json`
- Role-based browser audit report for admin, staff, researcher, and read-only users: `output/playwright/ui-final-audit/role-audit-report.json`
- `npm run verify:e2e:reuse:wsl -- --grep 'seeded user can log in and reach the dashboard' --project=chromium`
- `npm run verify:e2e:reuse:wsl -- --grep 'researcher can review the forecast workspace' --project=chromium`
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

- On 2026-05-18, `/api/v1/projects` was extended from read-only summaries to audited external project catalog sync with `POST` intake, duplicate-safe repeated submissions, `PATCH` updates for title/owner/notes, admin/colony-manager write access, read-only rejection, and catalog methods `["GET", "POST", "PATCH"]`.
- On 2026-05-10, a 1,000-animal local stress dataset exposed two local-test findings: Prisma dev on `localhost:51214` can remain TCP-open while timing out PostgreSQL probes under stress, and `/scan/lookup` could redirect browser automation to `0.0.0.0`; the scan redirect is now normalized to `localhost`, while DB recovery still depends on `npm run db:doctor` and restarting `npx prisma dev -d -n colony-maintenance` if probes fail.
- On 2026-05-10, high-volume navigation was optimized after regenerating a `FAST510` dataset with `1014` animals, `85` cages, `303` sample records, `154` health notes, `13` breeding setups, and `251` open alerts; the app shell now uses a lightweight alert count instead of recalculating dashboard rule metrics on every route, and heavy list views render in batches with explicit "show more" controls.
- On 2026-05-10, browser stress screenshots were written under `output/playwright/`, including `stress-route-sweep-final.png`, `stress-experiments-0K9OV3.png`, `stress-admin-cryostorage-and-audit-0K9OV3.png`, `stress-readonly-animals-0K9OV3.png`, and `stress-staff-direct-scan-0K9OV3B.png`.
- On 2026-05-09, the app UI was redesigned around a warmer lab-notebook visual system with an evergreen navigation rail, elevated page headers, redesigned primitive controls, mobile table-card layouts for animal/cage/sample/cryostorage workspaces, and a hidden Next dev indicator so it does not overlap mobile QA screenshots.
- On 2026-05-09, desktop/mobile route screenshots across all major modules passed a custom Playwright route audit with zero body overflow and one page heading per route.
- On 2026-05-09, role-based browser audits passed for admin, staff, researcher, and read-only users, including safe search/filter/navigation interactions and read-only form hiding on sample and cryostorage pages.
- On 2026-05-09, a compact maintained e2e slice passed four staff/researcher module tests before the local Prisma dev DB closed the app server connection during repeated per-test reseeding; after `db:doctor` passed and the app server was restarted, the failed forecast smoke passed individually.
- On 2026-04-26, `localhost:51214` initially had no listener and `npx prisma dev -d -n colony-maintenance` stalled in this WSL/mounted-workspace session; the listener later recovered and the targeted DB-backed unit and e2e checks above passed.
- On 2026-04-30, reusable Playwright verification was added through `E2E_REUSE_EXISTING_SERVER=1`; keep `npm run e2e:server` running in another shell for repeated local checks.
- On 2026-04-30, `npm run db:doctor` was added as a read-only preflight for `DATABASE_URL` and `DIRECT_DATABASE_URL`; it reports the configured host, port, database, TCP reachability, and PostgreSQL startup-protocol status before expensive verification starts.
- On 2026-04-30, local e2e server bootstrap switched to reseed-only startup to avoid repeated `prisma db push` cost and prepared-statement failures; use `db:prepare:local` explicitly after first setup, schema changes, or DB reset.
- On 2026-04-30, `/api/v1/samples` was added for external sample inventory integrations, with filtered sample reads, audited POST intake, idempotent duplicate handling for the same animal, and read-only role rejection.
- On 2026-05-01, `/api/v1/samples` was extended with audited `PATCH` sample lifecycle updates for status, storage location, quantity, and notes, so external LIMS workflows can update downstream sample state.
- On 2026-05-02, `/api/v1/animals` was extended with audited `PATCH` terminal lifecycle sync so external systems can mark euthanasia, death, transfer out, or archive states using the same transactional workflow as the app UI.
- On 2026-05-03, `/api/v1/animals` was extended with audited `POST` animal intake so external colony intake workflows can create live colony records using `animalCode`, `labId`, cage ids or barcodes, strain resolution by `strainId` or `strainName`, and optional project attribution.
- On 2026-05-03, `/api/v1/cages` was extended with audited `PATCH` cage move sync so external room-balancing or rack-tracking systems can relocate cages using the same transactional movement workflow as the app UI.
- On 2026-05-03, `/api/v1/breeding-setups` was added for external breeding scheduler intake, with audited `POST` creation using `sireCode`/`sireId` plus `damCode`/`damId`, duplicate-safe repeated submission handling, and optional admin override support for duplicate-breeder safeguards.
- On 2026-05-03, `/api/v1/litters` was added for external breeding-room litter intake, with audited `POST` creation on active breeding setups using `breedingSetupId` and duplicate-safe repeated submission handling.
- On 2026-05-03, `/api/v1/weanings` was added for external breeding-room weaning sync, with audited `POST` weaning on litters using `litterId`, holding-cage ids or barcodes, strain resolution by `strainId` or `strainName`, and duplicate-safe repeated submission handling.
- On 2026-05-02, `/api/v1/cryostorage` was added for external backup inventory integrations, with filtered reads, audited `POST` intake using `strainName`/`strainId` plus optional project resolution, idempotent duplicate handling, and audited `PATCH` lifecycle updates for status, storage location, quantity, recovery notes, and notes.
- On 2026-05-01, `/api/v1/cages/health-notes` was added for external cage welfare and equipment-event intake, using the same audited cage health-note workflow as scan-based staff entry.
- On 2026-05-01, `/api/v1/genotypes` was added for external genotype result integrations, with audited POST intake, animal/marker code resolution, duplicate handling for repeated vendor submissions, and read-only role rejection.
- On 2026-05-02, `/api/v1/genotypes` and `/api/v1/cages/health-notes` were extended to accept multipart attachment handoff so external vendors or monitoring systems can upload supporting documents into the same audited attachment flow the app UI already uses.
- On 2026-05-01, `/api/v1/experiments/assignments` was added for external scheduling integrations, with audited planned-assignment sync, experiment/animal code resolution, duplicate handling for repeated scheduler submissions, and read-only role rejection.
- On 2026-05-01, `/api/v1/experiments/assignments` was extended with `PATCH` promote/rollback actions for external assignment status sync using the same audited promotion and rollback workflow as the app UI.
- On 2026-05-05, `/api/v1/experiments/assignments/{assignmentId}` was added for external planned-assignment maintenance, with authenticated `GET`, audited `PATCH` edit support, and audited `DELETE` removal support using the same planned-cohort editor workflow as the app UI.
- On 2026-05-05, `/api/v1/experiments/reservations` was added for external direct reservation sync, with audited `POST` intake using `experimentCode`/`experimentId` plus `animalCode`/`animalId`, duplicate-safe repeated submission handling, and the same reservation workflow used by the app UI.
- On 2026-05-05, `/api/v1/rules` was added for external admin rule-config maintenance, with filtered `GET` summaries and audited `PATCH` updates using `ruleId`/`ruleKey` plus the same value parser and audit trail used by the settings UI.
- On 2026-05-05, `/api/v1/genotypes/import` was added for external bulk genotype CSV import, with JSON or multipart file intake, the same parser and 1 MB file guard as the app UI, and row-level audited genotype recording through the existing batch import workflow.
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
