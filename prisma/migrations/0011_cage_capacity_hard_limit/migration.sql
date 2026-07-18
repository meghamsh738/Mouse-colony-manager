INSERT INTO "AuditLog" (
  id, "actorId", "entityType", "entityId", action, "previousValue", "newValue", timestamp
)
SELECT
  'migration-0011-facility-' || md5(id),
  NULL,
  'facility',
  id,
  'capacity_hard_limit_normalization',
  jsonb_build_object('maxCageOccupancy', "maxCageOccupancy"),
  jsonb_build_object('maxCageOccupancy', GREATEST(1, LEAST("maxCageOccupancy", 6))),
  CURRENT_TIMESTAMP
FROM "Facility"
WHERE "maxCageOccupancy" NOT BETWEEN 1 AND 6
ON CONFLICT (id) DO NOTHING;

INSERT INTO "AuditLog" (
  id, "actorId", "entityType", "entityId", action, "previousValue", "newValue", timestamp
)
SELECT
  'migration-0011-cage-' || md5(id),
  NULL,
  'cage',
  id,
  'capacity_hard_limit_normalization',
  jsonb_build_object('capacityOverride', "capacityOverride"),
  jsonb_build_object(
    'capacityOverride',
    CASE WHEN "capacityOverride" < 1 THEN NULL ELSE 6 END
  ),
  CURRENT_TIMESTAMP
FROM "Cage"
WHERE "capacityOverride" IS NOT NULL
  AND "capacityOverride" NOT BETWEEN 1 AND 6
ON CONFLICT (id) DO NOTHING;

UPDATE "Facility"
SET "maxCageOccupancy" = GREATEST(1, LEAST("maxCageOccupancy", 6))
WHERE "maxCageOccupancy" NOT BETWEEN 1 AND 6;

UPDATE "Cage"
SET "capacityOverride" = CASE WHEN "capacityOverride" < 1 THEN NULL ELSE 6 END
WHERE "capacityOverride" IS NOT NULL
  AND "capacityOverride" NOT BETWEEN 1 AND 6;

ALTER TABLE "Facility"
ADD CONSTRAINT "Facility_maxCageOccupancy_range"
CHECK ("maxCageOccupancy" BETWEEN 1 AND 6);

ALTER TABLE "Cage"
ADD CONSTRAINT "Cage_capacityOverride_range"
CHECK ("capacityOverride" IS NULL OR "capacityOverride" BETWEEN 1 AND 6);
