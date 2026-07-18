BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "NotificationDelivery"
    GROUP BY "recipientId", kind, "preferenceVersion"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Duplicate notification deliveries must be reconciled before delivery identity hardening can continue.';
  END IF;
END
$$;

ALTER TABLE "NotificationDelivery"
  DROP CONSTRAINT "NotificationDelivery_recipientId_recipientVersion_kind_preferen",
  ADD CONSTRAINT "NotificationDelivery_recipient_kind_preference_key"
    UNIQUE ("recipientId", kind, "preferenceVersion");

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
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Notification delivery is not bound to an active recipient generation and exact outbox payload';
  END IF;

  RETURN NEW;
END
$$;

COMMIT;
