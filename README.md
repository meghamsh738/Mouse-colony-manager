# Mouse Colony Manager

Mouse Colony Manager is a Next.js + Prisma colony operations app for cage-first animal facility workflows and animal-first research workflows. The current runtime is PostgreSQL-backed with seeded dev data, Auth.js role-based login, Prisma transactions for active write flows, and Playwright coverage for the main end-to-end scenarios.

## Stack

- Next.js App Router
- TypeScript
- Prisma
- PostgreSQL
- Auth.js credentials auth for seeded dev users
- Tailwind CSS
- Vitest
- Playwright

## Local Setup

1. Start a local Postgres endpoint. In this repo the simplest path is Prisma's local dev server:

```bash
npx prisma dev -d -n colony-maintenance
```

2. Copy `.env.example` to `.env` and point both database URLs at that Postgres instance.

3. Apply the schema and seed the dev dataset:

```bash
npm run db:prepare
```

4. Start the app:

```bash
npm run dev
```

The app runs on `http://localhost:3000`.

Notification email delivery uses the configured rule values for provider URL, sender, and recipients. If the provider requires bearer auth, set `NOTIFICATION_EMAIL_API_TOKEN` in the runtime environment; no token is stored in the database.

## Production Notification Email

The notification delivery endpoint is intentionally provider-neutral. Configure these admin rules in `/settings`:

- `notify_email_enabled`: set to `true` when production email should be sent.
- `notify_email_provider_url`: set to an internal mail relay or provider adapter endpoint.
- `notify_email_from`: set to the sender address approved by the provider.
- `notify_email_digest_recipients`: set to comma, semicolon, or newline separated recipients.

Set `NOTIFICATION_EMAIL_API_TOKEN` in the runtime environment if the provider endpoint expects bearer auth. The app sends this JSON payload:

```json
{
  "from": "mouse-colony@colony.local",
  "to": ["manager@colony.local"],
  "subject": "Mouse Colony Manager: 4 active notifications",
  "text": "Digest body"
}
```

For Resend, Mailgun, SES, or an institutional SMTP bridge, put a small HTTPS adapter in front of the provider if its native API shape differs from the payload above. That keeps provider-specific credentials and transforms outside the app database.

## Seeded Accounts

All seeded dev users use the password `colony123`.

- `admin@colony.local`
- `manager@colony.local`
- `staff@colony.local`
- `researcher@colony.local`
- `readonly@colony.local`

## Useful Commands

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm test
npm run e2e:install
npm run e2e:install:wsl
npm run e2e:server
npm run test:e2e
npm run test:e2e:smoke
npm run test:e2e:wsl
npm run test:e2e:smoke:wsl
npm run verify
npm run verify:e2e
npm run verify:e2e:reuse
npm run verify:e2e:wsl
npm run verify:e2e:reuse:wsl
npm run verify:all
npm run verify:all:wsl
npm run db:doctor
npm run db:seed
npm run db:push
npm run db:prepare
npm run db:prepare:local
npm run db:prepare:ci
```

## What Is Persisted

- Auth users and roles are stored in PostgreSQL.
- Colony reads come directly from Prisma-backed read modules for animals, cages, scan, breeding, experiments, dashboard, exports, samples, cryostorage, forecast, and settings.
- Active write flows are Prisma-backed:
  - animal creation
  - cage health notes
  - cage moves
  - experiment reservation
  - planned experiment cohorts and assignment edits
  - breeding setup creation
  - litter recording and weaning
  - genotype recording and CSV genotype import
  - sample inventory
  - cryostorage inventory
  - lifecycle transitions
  - rules updates
- Genotype records and cage health notes can include attachment uploads. Metadata is stored in PostgreSQL, and uploaded files are stored locally under `public/uploads/attachments` for the MVP runtime.
- Audit logs, status events, project allocations, and experiment assignments are written transactionally.
- An authenticated integration API is available under `/api/v1` for animals, cages, experiments, projects, sample inventory, genotype intake, planned experiment assignment sync, and export discovery. `/api/v1/samples` supports filtered `GET` reads and audited `POST` sample intake for external LIMS-style systems using `animalCode`/`animalId` and optional `projectCode`/`projectId`; `/api/v1/genotypes` supports audited `POST` genotype result intake using `animalCode`/`animalId` plus `marker`/`alleleId`; `/api/v1/experiments/assignments` supports audited `POST` planned assignment sync using `experimentCode`/`experimentId` and animal codes.
- An in-app notification inbox is available under `/notifications`, with admin-editable rule toggles for overdue genotypes, weaning, breeder age, welfare follow-up, and reservation drift.
- Outbound notification delivery is available at `/api/v1/notifications/delivery` for dry-run payload preview, configured webhook delivery, and configured HTTP email-provider delivery.
- Quarantine and sentinel tracking is available under `/quarantine`, using quarantine cage status, welfare notes, cage flags, and rule-configured review thresholds.
- Experiment planning includes exclusion examples, seeded randomization, cage/sibling/age-band balancing, same-cage treatment-arm limits, overlap checks, and project-allocation risk for unallocated or multi-project animals.
- Breeding suggestions evaluate allele metadata, active breeding workload, admin-configured fertility scoring, line-specific fertility profiles, litter history, expected usable yield, and surplus risk.
- Forecasting compares planned experiment demand against available and projected usable supply, then surfaces 45-day supply gaps, configurable long-range runway, and avoidable surplus.

## Current Scope

The runtime app path is fully Postgres-backed through Prisma. The remaining seed fixtures now live under [`prisma/seed-data.ts`](./prisma/seed-data.ts), and runtime application code no longer imports the full colony seed dataset.

Progress tracking now lives in [`TODO.md`](./TODO.md).

## Verification

Current repo checks:

```bash
npm run verify
npm run verify:e2e
```

GitHub Actions mirrors this verification flow in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) with a fresh PostgreSQL service, a separate Playwright job, and artifact upload on e2e failures.

For a full local gate in one command:

```bash
npm run verify:all
```

If you want to debug the production-like e2e server outside Playwright, you can start the same seeded test server directly:

```bash
npm run e2e:server
```

That server bootstrap reseeds the database but does not rerun `prisma db push`, which keeps repeated local e2e starts faster and avoids Prisma dev prepared-statement state. Run `npm run db:prepare:local` after first setup, schema changes, or DB reset; it uses the direct database URL for Prisma CLI prep to avoid pooled-connection issues.

For repeated local browser checks, keep that server running in one terminal and reuse it from another:

```bash
npm run e2e:server
npm run verify:e2e:reuse -- --grep 'seeded user can log in and reach the dashboard' --project=chromium
npm run verify:e2e:reuse:wsl -- --grep 'seeded user can log in and reach the dashboard' --project=chromium
```

Use the normal `verify:e2e` or `verify:e2e:wsl` path when you need Playwright to own server startup. Restart the reusable server after code, environment, schema, or seed changes.

For the fastest meaningful browser check, use the seeded-login smoke:

```bash
npm run test:e2e:smoke
npm run test:e2e:smoke:wsl
```

If local Prisma-backed tests fail before the app starts, run the read-only DB doctor first:

```bash
npm run db:doctor
```

If the configured endpoint is down, start it with `npx prisma dev -d -n colony-maintenance`, then run `npm run db:prepare:local` and retry `npm run db:doctor`.

On Ubuntu/Debian WSL without `sudo`, Playwright can fail to launch Chromium because shared libraries such as `libnspr4.so` are not present. Use the rootless wrapper scripts below to download and extract the required packages into `~/.cache/colony-maintenance/playwright-libs` and rerun Playwright with the correct `LD_LIBRARY_PATH`:

```bash
npm run e2e:install:wsl
npm run test:e2e:wsl
npm run verify:e2e:wsl
npm run verify:all:wsl
```

Clean-checkout verification was also run from a disposable clone with:

```bash
npm ci
cp .env.example .env
npm run db:prepare
npm run verify
```
