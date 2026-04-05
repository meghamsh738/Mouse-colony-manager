# Prisma/Postgres Migration Checklist

This tracker covers the work required to replace the persisted demo store with real Prisma/Postgres CRUD.

## Infrastructure

- [x] Add shared Prisma client and server-only database access helpers.
- [x] Add committed Prisma migrations for the current schema.
- [x] Make local development and test database setup repeatable.
- [x] Remove runtime JSON store usage from the application path.

## Auth

- [x] Move user lookup and credential validation to Prisma-backed users.
- [x] Replace demo password handling with seeded dev credentials stored in the database.
- [x] Protect exports and mutations with verified session checks instead of cookie presence.

## Reads

- [x] Replace `colonyData` array reads with Prisma queries.
- [x] Add mappers for DB records to existing view models and snapshot helpers.
- [x] Load dashboards, cages, animals, breeding, experiments, rules, and audit views from Postgres.

## Writes

- [x] Create animals through Prisma transactions with audit and status events.
- [x] Create cage health notes through Prisma transactions.
- [x] Create experiment reservations through Prisma transactions with conflict checks.
- [x] Remove remaining demo write helpers once all active mutations are DB-backed.

## Data And Rules

- [x] Read rule configs from Prisma and keep alert generation DB-backed.
- [x] Seed a realistic dev dataset into Postgres.
- [ ] Make exports read directly from Prisma query results.

## Testing

- [x] Reset and seed a test database for unit tests.
- [x] Reset and seed a test database for Playwright runs.
- [x] Remove `.runtime-data` dependence from automated tests.

## Cleanup

- [ ] Remove or archive demo-only data structures once Prisma is the runtime source of truth.
- [x] Update README and environment docs for Postgres-backed setup.
- [ ] Commit, push branch, and verify the repo from a clean checkout.
