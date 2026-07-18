BEGIN;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ExperimentAssignment"
    GROUP BY "experimentId", "animalId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'experiment assignment migration blocked: duplicate experiment and animal links require reconciliation';
  END IF;
END
$migration$;

ALTER TABLE "ExperimentAssignment"
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "ExperimentAssignment_version_check" CHECK (version >= 1);

CREATE UNIQUE INDEX "ExperimentAssignment_experimentId_animalId_key"
  ON "ExperimentAssignment" ("experimentId", "animalId");

COMMIT;
