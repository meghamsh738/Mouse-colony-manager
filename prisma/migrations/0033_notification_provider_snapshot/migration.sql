BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

ALTER TABLE "NotificationDelivery"
  ADD COLUMN "eventVersion" INTEGER,
  ADD COLUMN "providerRequestBody" TEXT,
  ADD COLUMN "providerRequestHash" TEXT,
  ADD COLUMN "providerIdempotencyKey" TEXT,
  ADD COLUMN "providerRequestTo" TEXT,
  ADD COLUMN "providerAdapter" TEXT,
  ADD COLUMN "providerEndpoint" TEXT,
  ADD COLUMN "providerAccount" TEXT,
  ADD COLUMN "providerRequestPreparedAt" TIMESTAMP(3);

UPDATE "OutboxDeliveryAttempt" attempt
SET status = 'failed',
    "completedAt" = CURRENT_TIMESTAMP,
    "errorMessage" = 'Legacy notification delivery was cancelled before immutable provider snapshot activation.'
FROM "NotificationDelivery" delivery
WHERE delivery."outboxMessageId" = attempt."messageId"
  AND delivery.status = 'queued'
  AND attempt.status = 'processing';

UPDATE "OutboxMessage" message
SET status = 'cancelled',
    "leaseOwner" = NULL,
    "leaseToken" = NULL,
    "workerType" = NULL,
    "leasedAt" = NULL,
    "leaseExpiresAt" = NULL,
    "lastError" = 'Legacy notification delivery was cancelled before immutable provider snapshot activation.'
FROM "NotificationDelivery" delivery
WHERE delivery."outboxMessageId" = message.id
  AND delivery.status = 'queued';

UPDATE "NotificationDelivery"
SET status = 'cancelled',
    "cancelledAt" = CURRENT_TIMESTAMP,
    "lastError" = 'Legacy notification delivery was cancelled before immutable provider snapshot activation.',
    version = version + 1
WHERE status = 'queued';

ALTER TABLE "NotificationDelivery"
  DROP CONSTRAINT "NotificationDelivery_recipient_kind_preference_key",
  ADD CONSTRAINT "NotificationDelivery_recipient_kind_preference_event_key"
    UNIQUE ("recipientId", kind, "preferenceVersion", "eventVersion"),
  ADD CONSTRAINT "NotificationDelivery_event_version_check"
    CHECK ("eventVersion" IS NULL OR "eventVersion" >= 1),
  ADD CONSTRAINT "NotificationDelivery_provider_snapshot_check"
    CHECK (
      (
        "providerRequestBody" IS NULL
        AND "providerRequestHash" IS NULL
        AND "providerIdempotencyKey" IS NULL
        AND "providerRequestTo" IS NULL
        AND "providerAdapter" IS NULL
        AND "providerEndpoint" IS NULL
        AND "providerAccount" IS NULL
        AND "providerRequestPreparedAt" IS NULL
      )
      OR (
        "providerRequestBody" IS NOT NULL
        AND "providerRequestHash" IS NOT NULL
        AND "providerIdempotencyKey" IS NOT NULL
        AND "providerRequestTo" IS NOT NULL
        AND "providerAdapter" IS NOT NULL
        AND "providerEndpoint" IS NOT NULL
        AND "providerAccount" IS NOT NULL
        AND char_length("providerRequestBody") BETWEEN 2 AND 1000000
        AND "providerRequestHash" ~ '^[0-9a-f]{64}$'
        AND "providerIdempotencyKey" = id
        AND char_length(btrim("providerRequestTo")) BETWEEN 3 AND 320
        AND char_length("providerAdapter") BETWEEN 1 AND 100
        AND "providerAdapter" = btrim(lower("providerAdapter"))
        AND char_length("providerEndpoint") BETWEEN 8 AND 2048
        AND "providerEndpoint" = btrim("providerEndpoint")
        AND char_length("providerAccount") BETWEEN 1 AND 320
        AND "providerAccount" = btrim(lower("providerAccount"))
        AND "providerRequestPreparedAt" IS NOT NULL
      )
    );

CREATE OR REPLACE FUNCTION "validate_notification_delivery_binding"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  recipient_row "NotificationRecipient"%ROWTYPE;
  event_row "NotificationEvent"%ROWTYPE;
  outbox_row "OutboxMessage"%ROWTYPE;
  expected_topic TEXT;
BEGIN
  SELECT * INTO recipient_row FROM "NotificationRecipient" WHERE id = NEW."recipientId";
  SELECT * INTO event_row FROM "NotificationEvent" WHERE id = recipient_row."eventId";
  SELECT * INTO outbox_row FROM "OutboxMessage" WHERE id = NEW."outboxMessageId";
  expected_topic := CASE WHEN NEW.kind = 'immediate' THEN 'notifications.email' ELSE 'notifications.digest' END;

  IF recipient_row.id IS NULL
    OR recipient_row.status <> 'active'
    OR event_row.id IS NULL
    OR event_row.status = 'resolved'
    OR NEW."eventVersion" IS NULL
    OR NEW."eventVersion" IS DISTINCT FROM event_row.version
    OR outbox_row.id IS NULL
    OR outbox_row.topic IS DISTINCT FROM expected_topic
    OR outbox_row."aggregateType" IS DISTINCT FROM 'notification_delivery'
    OR outbox_row."aggregateId" IS DISTINCT FROM NEW.id
    OR outbox_row."labId" IS DISTINCT FROM recipient_row."labId"
    OR outbox_row.payload->>'deliveryId' IS DISTINCT FROM NEW.id
    OR outbox_row.payload->>'recipientId' IS DISTINCT FROM NEW."recipientId"
    OR outbox_row.payload->>'recipientVersion' IS DISTINCT FROM NEW."recipientVersion"::text
    OR outbox_row.payload->>'preferenceVersion' IS DISTINCT FROM NEW."preferenceVersion"::text
    OR outbox_row.payload->>'eventId' IS DISTINCT FROM event_row.id
    OR outbox_row.payload->>'eventVersion' IS DISTINCT FROM NEW."eventVersion"::text
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Notification delivery is not bound to an exact event version, active recipient generation, and outbox payload';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION "protect_notification_delivery_history"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN CASE WHEN TG_OP = 'TRUNCATE' THEN NULL WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Notification delivery history cannot be deleted or truncated';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'queued' OR NEW.version <> 1 OR NEW."attemptCount" <> 0 OR NEW."eventVersion" IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Notification deliveries must start queued at version one with an exact event version and no attempts';
    END IF;
  ELSIF NEW.id IS DISTINCT FROM OLD.id
    OR NEW."recipientId" IS DISTINCT FROM OLD."recipientId"
    OR NEW."recipientVersion" IS DISTINCT FROM OLD."recipientVersion"
    OR NEW."preferenceVersion" IS DISTINCT FROM OLD."preferenceVersion"
    OR NEW."eventVersion" IS DISTINCT FROM OLD."eventVersion"
    OR NEW."outboxMessageId" IS DISTINCT FROM OLD."outboxMessageId"
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW."scheduledFor" IS DISTINCT FROM OLD."scheduledFor"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR (OLD."providerRequestBody" IS NOT NULL AND (
      NEW."providerRequestBody" IS DISTINCT FROM OLD."providerRequestBody"
      OR NEW."providerRequestHash" IS DISTINCT FROM OLD."providerRequestHash"
      OR NEW."providerIdempotencyKey" IS DISTINCT FROM OLD."providerIdempotencyKey"
      OR NEW."providerRequestTo" IS DISTINCT FROM OLD."providerRequestTo"
      OR NEW."providerAdapter" IS DISTINCT FROM OLD."providerAdapter"
      OR NEW."providerEndpoint" IS DISTINCT FROM OLD."providerEndpoint"
      OR NEW."providerAccount" IS DISTINCT FROM OLD."providerAccount"
      OR NEW."providerRequestPreparedAt" IS DISTINCT FROM OLD."providerRequestPreparedAt"
    ))
    OR OLD.status IN ('delivered', 'failed', 'cancelled')
    OR NEW.version <> OLD.version + 1
    OR NEW."attemptCount" < OLD."attemptCount"
  THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Notification delivery identity, provider snapshot, or terminal history is immutable';
  END IF;
  RETURN NEW;
END
$$;

COMMIT;
