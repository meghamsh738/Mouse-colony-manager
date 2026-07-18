-- Dispatch table-specific checks before referencing fields on polymorphic NEW records.
-- PostgreSQL resolves record fields inside a boolean expression even when the
-- TG_TABLE_NAME predicate is false, so each table needs its own nested branch.
CREATE OR REPLACE FUNCTION "assert_active_ownership_same_lab"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'Animal' THEN
    IF EXISTS (
      SELECT 1
      FROM "ExperimentAssignment" assignment
      JOIN "Experiment" e ON e.id = assignment."experimentId"
      WHERE assignment."animalId" = NEW.id
        AND assignment.status NOT IN ('completed', 'cancelled')
        AND e."labId" IS DISTINCT FROM NEW."owningLabId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Animal transfer would leave an open ExperimentAssignment in another lab';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "AnimalProjectAllocation" allocation
      JOIN "Project" p ON p.id = allocation."projectId"
      WHERE allocation."animalId" = NEW.id
        AND allocation."endedAt" IS NULL
        AND p."labId" IS DISTINCT FROM NEW."owningLabId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Animal transfer would leave an open AnimalProjectAllocation in another lab';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "BreedingAdult" adult
      JOIN "BreedingSetup" setup ON setup.id = adult."breedingSetupId"
      WHERE adult."animalId" = NEW.id
        AND setup.status IN ('planned', 'active', 'paused')
        AND setup."labId" IS DISTINCT FROM NEW."owningLabId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Animal transfer would leave a current BreedingAdult relation in another lab';
    END IF;

  ELSIF TG_TABLE_NAME = 'Experiment' THEN
    IF EXISTS (
      SELECT 1
      FROM "ExperimentAssignment" assignment
      JOIN "Animal" a ON a.id = assignment."animalId"
      WHERE assignment."experimentId" = NEW.id
        AND assignment.status NOT IN ('completed', 'cancelled')
        AND a."owningLabId" IS DISTINCT FROM NEW."labId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Experiment lab change would leave an open ExperimentAssignment in another lab';
    END IF;

  ELSIF TG_TABLE_NAME = 'Project' THEN
    IF EXISTS (
      SELECT 1
      FROM "AnimalProjectAllocation" allocation
      JOIN "Animal" a ON a.id = allocation."animalId"
      WHERE allocation."projectId" = NEW.id
        AND allocation."endedAt" IS NULL
        AND a."owningLabId" IS DISTINCT FROM NEW."labId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Project lab change would leave an open AnimalProjectAllocation in another lab';
    END IF;

  ELSIF TG_TABLE_NAME = 'BreedingSetup' THEN
    IF NEW.status IN ('planned', 'active', 'paused') AND EXISTS (
      SELECT 1
      FROM "BreedingAdult" adult
      JOIN "Animal" a ON a.id = adult."animalId"
      WHERE adult."breedingSetupId" = NEW.id
        AND a."owningLabId" IS DISTINCT FROM NEW."labId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'BreedingSetup lab/status change would leave a current BreedingAdult relation in another lab';
    END IF;
  END IF;

  RETURN NULL;
END $$;
