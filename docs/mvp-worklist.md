# MVP Worklist

This checklist tracks the remaining operational workflows needed to close the MVP gap after the Prisma/Postgres migration.

## Completed

- [x] Prisma/Postgres runtime migration
- [x] Auth backed by seeded Prisma users
- [x] Animal creation workflow
- [x] Cage health note entry from scan view
- [x] Experiment reservation with conflict checks
- [x] Breeding setup creation
- [x] Litter recording
- [x] Litter weaning and progeny assignment
- [x] Manual genotype entry from animal detail
- [x] Batch genotype import for vendor or CSV uploads
- [x] Animal lifecycle status change UI for euthanasia, death, transfer, and archive
- [x] Cage movement workflow with movement history entry
- [x] Rule settings write UI for admin-editable thresholds
- [x] Export polish for more filtered operational views

## Next
- [ ] Validate or replace the blocked Vitest worker bootstrap path for unit coverage

## QA Follow-up

- [x] Add dedicated Playwright coverage for genotype imports once the batch workflow exists
- [x] Add coverage for animal lifecycle transitions and archive filtering
