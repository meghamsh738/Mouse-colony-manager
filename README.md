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
npm run test:e2e:wsl
npm run verify
npm run verify:e2e
npm run verify:e2e:wsl
npm run verify:all
npm run verify:all:wsl
npm run db:seed
npm run db:push
npm run db:prepare
npm run db:prepare:ci
```

## What Is Persisted

- Auth users and roles are stored in PostgreSQL.
- Colony reads come directly from Prisma-backed read modules for animals, cages, scan, breeding, experiments, dashboard, exports, and settings.
- Active write flows are Prisma-backed:
  - animal creation
  - cage health notes
  - experiment reservation
- Audit logs, status events, project allocations, and experiment assignments are written transactionally.

## Current Scope

The runtime app path is fully Postgres-backed through Prisma. The remaining seed fixtures now live under [`prisma/seed-data.ts`](./prisma/seed-data.ts), and runtime application code no longer imports the full colony seed dataset.

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

That server bootstrap now applies the local schema automatically with `db:prepare`. In CI, the same script falls back to `db:seed` because migrations are already applied earlier in the workflow.

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
