BEGIN;

CREATE UNIQUE INDEX "CryostorageRequestEvent_requestId_eventType_key"
  ON "CryostorageRequestEvent" ("requestId", "eventType");

CREATE OR REPLACE FUNCTION "assert_cryostorage_request_completion_row"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  request_status "CryostorageRequestStatus";
  operation_count INTEGER;
  event_count INTEGER;
  submitted_event_count INTEGER;
  terminal_event_count INTEGER;
BEGIN
  SELECT status INTO request_status FROM "CryostorageRequest" WHERE id = NEW.id;
  SELECT COUNT(*) INTO operation_count FROM "CryostorageOperation" WHERE "requestId" = NEW.id;
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE "eventType" = 'submitted'),
    COUNT(*) FILTER (WHERE "eventType"::text = request_status::text)
  INTO event_count, submitted_event_count, terminal_event_count
  FROM "CryostorageRequestEvent"
  WHERE "requestId" = NEW.id;

  IF (request_status = 'completed' AND operation_count <> 1)
    OR (request_status <> 'completed' AND operation_count <> 0)
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Completed cryostorage requests require exactly one matching operation';
  END IF;

  IF submitted_event_count <> 1
    OR (request_status = 'submitted' AND event_count <> 1)
    OR (request_status <> 'submitted' AND (event_count <> 2 OR terminal_event_count <> 1))
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Cryostorage request event history is incomplete or inconsistent';
  END IF;

  RETURN NEW;
END
$$;

COMMIT;
