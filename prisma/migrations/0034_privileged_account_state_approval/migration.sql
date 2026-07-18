ALTER TABLE "PrivilegedRoleChangeRequest"
  ADD COLUMN "requestedByAuthzVersion" INTEGER,
  ADD COLUMN "requestedActive" BOOLEAN;

-- Existing pending decisions predate requester authority snapshots and cannot
-- be approved safely after this migration.
UPDATE "PrivilegedRoleChangeRequest"
SET "status" = 'expired'
WHERE "status" = 'pending';

UPDATE "PrivilegedRoleChangeRequest" request
SET "requestedByAuthzVersion" = actor."authzVersion"
FROM "User" actor
WHERE actor."id" = request."requestedById";

ALTER TABLE "PrivilegedRoleChangeRequest"
  ALTER COLUMN "requestedByAuthzVersion" SET NOT NULL;
