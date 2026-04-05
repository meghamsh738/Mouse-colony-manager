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

2. Copy `.env.example` to `.env` and point both URLs at that Postgres instance.

3. Apply the schema and seed the dev dataset:

```bash
npx prisma db push
npm run db:seed
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
npm run test:e2e
npm run db:seed
```

## What Is Persisted

- Auth users and roles are stored in PostgreSQL.
- Colony reads hydrate from Prisma queries through the snapshot mapper in `src/lib/colony-data.ts`.
- Active write flows are Prisma-backed:
  - animal creation
  - cage health notes
  - experiment reservation
- Audit logs, status events, project allocations, and experiment assignments are written transactionally.

## Current Scope

The app is Postgres-backed for the active workflows above, but some read models still pass through the compatibility snapshot layer in `src/lib/colony.ts` so the existing UI helpers can be reused. That keeps the product functional while the remaining demo-shaped read helpers are retired incrementally.

## Verification

Current repo checks:

```bash
npm run typecheck
npm run lint
npm test
LD_LIBRARY_PATH="$PWD/.runtime-libs/usr/lib/x86_64-linux-gnu" npm run test:e2e -- --reporter=line
npm run build
```
