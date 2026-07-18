ALTER TABLE "Project" ADD COLUMN "labId" TEXT;
ALTER TABLE "Experiment" ADD COLUMN "labId" TEXT;
ALTER TABLE "BreedingSetup" ADD COLUMN "labId" TEXT;
ALTER TABLE "SampleRecord" ADD COLUMN "labId" TEXT;
ALTER TABLE "CryostorageRecord" ADD COLUMN "labId" TEXT;
ALTER TABLE "HealthNote" ADD COLUMN "labId" TEXT;
ALTER TABLE "GenotypingRecord" ADD COLUMN "labId" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "labId" TEXT;
ALTER TABLE "Alert" ADD COLUMN "labId" TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Cage" WHERE "labId" IS NULL) THEN
    RAISE EXCEPTION 'Cage ownership backfill is incomplete. Resolve null labId values before migration.';
  END IF;
  IF EXISTS (SELECT 1 FROM "Animal" WHERE "owningLabId" IS NULL) THEN
    RAISE EXCEPTION 'Animal ownership backfill is incomplete. Resolve null owningLabId values before migration.';
  END IF;
END $$;

ALTER TABLE "Cage" ALTER COLUMN "labId" SET NOT NULL;
ALTER TABLE "Animal" ALTER COLUMN "owningLabId" SET NOT NULL;

UPDATE "Project" p
SET "labId" = inferred."labId"
FROM (
  SELECT p2.id,
    COALESCE(
      (
        SELECT MIN(a."owningLabId")
        FROM "AnimalProjectAllocation" apa
        JOIN "Animal" a ON a.id = apa."animalId"
        WHERE apa."projectId" = p2.id AND a."owningLabId" IS NOT NULL
        HAVING COUNT(DISTINCT a."owningLabId") = 1
      ),
      (
        SELECT MIN(lm."labId")
        FROM "LabMembership" lm
        WHERE lm."userId" = p2."ownerId" AND lm.active = TRUE
        HAVING COUNT(DISTINCT lm."labId") = 1
      )
    ) AS "labId"
  FROM "Project" p2
) inferred
WHERE p.id = inferred.id;

UPDATE "Experiment" e SET "labId" = p."labId" FROM "Project" p WHERE p.id = e."projectId";
UPDATE "SampleRecord" s SET "labId" = a."owningLabId" FROM "Animal" a WHERE a.id = s."animalId";
UPDATE "BreedingSetup" b
SET "labId" = inferred."labId"
FROM (
  SELECT ba."breedingSetupId" AS id, MIN(a."owningLabId") AS "labId"
  FROM "BreedingAdult" ba
  JOIN "Animal" a ON a.id = ba."animalId"
  WHERE a."owningLabId" IS NOT NULL
  GROUP BY ba."breedingSetupId"
  HAVING COUNT(DISTINCT a."owningLabId") = 1
) inferred
WHERE b.id = inferred.id;
UPDATE "GenotypingRecord" g SET "labId" = a."owningLabId" FROM "Animal" a WHERE a.id = g."animalId";
UPDATE "HealthNote" h
SET "labId" = COALESCE(a."owningLabId", c."labId")
FROM "HealthNote" source
LEFT JOIN "Animal" a ON a.id = source."animalId"
LEFT JOIN "Cage" c ON c.id = source."cageId"
WHERE h.id = source.id;
UPDATE "CryostorageRecord" c
SET "labId" = COALESCE(
  p."labId",
  (
    SELECT MIN(lm."labId")
    FROM "LabMembership" lm
    WHERE lm."userId" = c."createdById" AND lm.active = TRUE
    HAVING COUNT(DISTINCT lm."labId") = 1
  )
)
FROM "CryostorageRecord" source
LEFT JOIN "Project" p ON p.id = source."projectId"
WHERE c.id = source.id;
UPDATE "Attachment" attachment
SET "labId" = COALESCE(a."owningLabId", c."labId", h."labId", g."labId")
FROM "Attachment" source
LEFT JOIN "Animal" a ON a.id = source."animalId"
LEFT JOIN "Cage" c ON c.id = source."cageId"
LEFT JOIN "HealthNote" h ON h.id = source."healthNoteId"
LEFT JOIN "GenotypingRecord" g ON g.id = source."genotypingRecordId"
WHERE attachment.id = source.id;

UPDATE "Alert" alert SET "labId" = a."owningLabId" FROM "Animal" a WHERE alert."entityType" = 'animal' AND alert."entityId" = a.id;
UPDATE "Alert" alert SET "labId" = c."labId" FROM "Cage" c WHERE alert."entityType" = 'cage' AND alert."entityId" = c.id;
UPDATE "Alert" alert SET "labId" = b."labId" FROM "BreedingSetup" b WHERE alert."entityType" = 'breeding_setup' AND alert."entityId" = b.id;
UPDATE "Alert" alert SET "labId" = e."labId" FROM "Experiment" e WHERE alert."entityType" = 'experiment' AND alert."entityId" = e.id;
UPDATE "Alert" alert SET "labId" = s."labId" FROM "SampleRecord" s WHERE alert."entityType" = 'sample_record' AND alert."entityId" = s.id;
UPDATE "Alert" alert SET "labId" = c."labId" FROM "CryostorageRecord" c WHERE alert."entityType" = 'cryostorage_record' AND alert."entityId" = c.id;
UPDATE "Alert" alert SET "labId" = h."labId" FROM "HealthNote" h WHERE alert."entityType" = 'health_note' AND alert."entityId" = h.id;

DO $$
DECLARE
  missing_table TEXT;
BEGIN
  SELECT table_name INTO missing_table
  FROM (VALUES
    ('Project'), ('Experiment'), ('BreedingSetup'), ('SampleRecord'), ('CryostorageRecord'),
    ('HealthNote'), ('GenotypingRecord'), ('Attachment')
  ) required(table_name)
  WHERE EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = current_schema() AND c.table_name = required.table_name AND c.column_name = 'labId'
  )
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_class pc
    JOIN pg_catalog.pg_namespace pn ON pn.oid = pc.relnamespace
    WHERE pn.nspname = current_schema() AND pc.relname = required.table_name
  )
  AND CASE required.table_name
    WHEN 'Project' THEN EXISTS (SELECT 1 FROM "Project" WHERE "labId" IS NULL)
    WHEN 'Experiment' THEN EXISTS (SELECT 1 FROM "Experiment" WHERE "labId" IS NULL)
    WHEN 'BreedingSetup' THEN EXISTS (SELECT 1 FROM "BreedingSetup" WHERE "labId" IS NULL)
    WHEN 'SampleRecord' THEN EXISTS (SELECT 1 FROM "SampleRecord" WHERE "labId" IS NULL)
    WHEN 'CryostorageRecord' THEN EXISTS (SELECT 1 FROM "CryostorageRecord" WHERE "labId" IS NULL)
    WHEN 'HealthNote' THEN EXISTS (SELECT 1 FROM "HealthNote" WHERE "labId" IS NULL)
    WHEN 'GenotypingRecord' THEN EXISTS (SELECT 1 FROM "GenotypingRecord" WHERE "labId" IS NULL)
    WHEN 'Attachment' THEN EXISTS (SELECT 1 FROM "Attachment" WHERE "labId" IS NULL)
  END
  LIMIT 1;

  IF missing_table IS NOT NULL THEN
    RAISE EXCEPTION 'Explicit lab ownership backfill is ambiguous for table %. Resolve ownership exceptions before migration.', missing_table;
  END IF;
END $$;

ALTER TABLE "Project" ALTER COLUMN "labId" SET NOT NULL;
ALTER TABLE "Experiment" ALTER COLUMN "labId" SET NOT NULL;
ALTER TABLE "BreedingSetup" ALTER COLUMN "labId" SET NOT NULL;
ALTER TABLE "SampleRecord" ALTER COLUMN "labId" SET NOT NULL;
ALTER TABLE "CryostorageRecord" ALTER COLUMN "labId" SET NOT NULL;
ALTER TABLE "HealthNote" ALTER COLUMN "labId" SET NOT NULL;
ALTER TABLE "GenotypingRecord" ALTER COLUMN "labId" SET NOT NULL;
ALTER TABLE "Attachment" ALTER COLUMN "labId" SET NOT NULL;

ALTER TABLE "Project" ADD CONSTRAINT "Project_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BreedingSetup" ADD CONSTRAINT "BreedingSetup_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SampleRecord" ADD CONSTRAINT "SampleRecord_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CryostorageRecord" ADD CONSTRAINT "CryostorageRecord_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HealthNote" ADD CONSTRAINT "HealthNote_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GenotypingRecord" ADD CONSTRAINT "GenotypingRecord_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Project_labId_idx" ON "Project"("labId");
CREATE INDEX "Experiment_labId_idx" ON "Experiment"("labId");
CREATE INDEX "BreedingSetup_labId_idx" ON "BreedingSetup"("labId");
CREATE INDEX "SampleRecord_labId_idx" ON "SampleRecord"("labId");
CREATE INDEX "CryostorageRecord_labId_idx" ON "CryostorageRecord"("labId");
CREATE INDEX "HealthNote_labId_idx" ON "HealthNote"("labId");
CREATE INDEX "GenotypingRecord_labId_idx" ON "GenotypingRecord"("labId");
CREATE INDEX "Attachment_labId_idx" ON "Attachment"("labId");
CREATE INDEX "Alert_labId_status_idx" ON "Alert"("labId", "status");
