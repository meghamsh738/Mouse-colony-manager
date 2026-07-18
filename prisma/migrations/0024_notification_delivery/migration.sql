BEGIN;

CREATE TYPE "NotificationEmailMode" AS ENUM ('off', 'daily_digest', 'weekly_digest');
CREATE TYPE "NotificationDeliveryKind" AS ENUM ('immediate', 'digest');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('queued', 'delivered', 'failed', 'cancelled');

ALTER TABLE "NotificationRecipient"
  DROP CONSTRAINT "NotificationRecipient_eventId_userId_key";
CREATE UNIQUE INDEX "NotificationRecipient_eventId_userId_active_key"
  ON "NotificationRecipient" ("eventId", "userId")
  WHERE status = 'active';
CREATE INDEX "NotificationRecipient_eventId_userId_idx"
  ON "NotificationRecipient" ("eventId", "userId");

CREATE TABLE "NotificationPreference" (
  id TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "categoryKey" TEXT NOT NULL,
  "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
  "emailMode" "NotificationEmailMode" NOT NULL DEFAULT 'off',
  "digestHourUtc" INTEGER NOT NULL DEFAULT 8,
  "digestDayOfWeek" INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY (id),
  CONSTRAINT "NotificationPreference_userId_categoryKey_key" UNIQUE ("userId", "categoryKey"),
  CONSTRAINT "NotificationPreference_category_check" CHECK (char_length(btrim("categoryKey")) BETWEEN 1 AND 80),
  CONSTRAINT "NotificationPreference_hour_check" CHECK ("digestHourUtc" BETWEEN 0 AND 23),
  CONSTRAINT "NotificationPreference_day_check" CHECK ("digestDayOfWeek" BETWEEN 0 AND 6),
  CONSTRAINT "NotificationPreference_version_check" CHECK (version >= 1)
);

CREATE TABLE "NotificationDelivery" (
  id TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "recipientVersion" INTEGER NOT NULL,
  "preferenceVersion" INTEGER NOT NULL DEFAULT 0,
  "outboxMessageId" TEXT NOT NULL,
  kind "NotificationDeliveryKind" NOT NULL,
  status "NotificationDeliveryStatus" NOT NULL DEFAULT 'queued',
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "deliveredTo" TEXT,
  "providerMessageId" TEXT,
  "providerStatus" INTEGER,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  version INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY (id),
  CONSTRAINT "NotificationDelivery_outboxMessageId_key" UNIQUE ("outboxMessageId"),
  CONSTRAINT "NotificationDelivery_recipientId_recipientVersion_kind_preferen"
    UNIQUE ("recipientId", "recipientVersion", kind, "preferenceVersion"),
  CONSTRAINT "NotificationDelivery_version_check" CHECK (version >= 1),
  CONSTRAINT "NotificationDelivery_recipient_version_check" CHECK ("recipientVersion" >= 1),
  CONSTRAINT "NotificationDelivery_preference_version_check" CHECK ("preferenceVersion" >= 0),
  CONSTRAINT "NotificationDelivery_attempt_count_check" CHECK ("attemptCount" >= 0),
  CONSTRAINT "NotificationDelivery_provider_status_check" CHECK (
    "providerStatus" IS NULL OR "providerStatus" BETWEEN 100 AND 599
  ),
  CONSTRAINT "NotificationDelivery_status_check" CHECK (
    (
      status = 'queued'
      AND "deliveredAt" IS NULL
      AND "failedAt" IS NULL
      AND "cancelledAt" IS NULL
    )
    OR (
      status = 'delivered'
      AND "deliveredAt" IS NOT NULL
      AND "failedAt" IS NULL
      AND "cancelledAt" IS NULL
      AND char_length(btrim(COALESCE("deliveredTo", ''))) BETWEEN 3 AND 320
    )
    OR (
      status = 'failed'
      AND "deliveredAt" IS NULL
      AND "failedAt" IS NOT NULL
      AND "cancelledAt" IS NULL
      AND char_length(btrim(COALESCE("lastError", ''))) BETWEEN 3 AND 2000
    )
    OR (
      status = 'cancelled'
      AND "deliveredAt" IS NULL
      AND "failedAt" IS NULL
      AND "cancelledAt" IS NOT NULL
      AND char_length(btrim(COALESCE("lastError", ''))) BETWEEN 3 AND 2000
    )
  )
);

CREATE INDEX "NotificationPreference_userId_updatedAt_idx"
  ON "NotificationPreference" ("userId", "updatedAt");
CREATE INDEX "NotificationDelivery_status_scheduledFor_idx"
  ON "NotificationDelivery" (status, "scheduledFor");
CREATE INDEX "NotificationDelivery_recipientId_createdAt_idx"
  ON "NotificationDelivery" ("recipientId", "createdAt");

ALTER TABLE "NotificationPreference"
  ADD CONSTRAINT "NotificationPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationDelivery"
  ADD CONSTRAINT "NotificationDelivery_recipientId_fkey"
    FOREIGN KEY ("recipientId") REFERENCES "NotificationRecipient"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "NotificationDelivery_outboxMessageId_fkey"
    FOREIGN KEY ("outboxMessageId") REFERENCES "OutboxMessage"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "validate_notification_delivery_binding"()
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
    OR recipient_row.version IS DISTINCT FROM NEW."recipientVersion"
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
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Notification delivery is not bound to a current recipient and exact outbox payload';
  END IF;

  RETURN NEW;
END
$$;

CREATE FUNCTION "protect_notification_preference_history"()
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
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Notification preferences cannot be deleted or truncated';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Notification preferences must start at version one';
    END IF;
  ELSIF NEW.id IS DISTINCT FROM OLD.id
    OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."categoryKey" IS DISTINCT FROM OLD."categoryKey"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW.version <> OLD.version + 1
  THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Notification preference identity is immutable and updates must advance one version';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION "protect_notification_delivery_history"()
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
    IF NEW.status <> 'queued' OR NEW.version <> 1 OR NEW."attemptCount" <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Notification deliveries must start queued at version one with no attempts';
    END IF;
  ELSIF NEW.id IS DISTINCT FROM OLD.id
    OR NEW."recipientId" IS DISTINCT FROM OLD."recipientId"
    OR NEW."recipientVersion" IS DISTINCT FROM OLD."recipientVersion"
    OR NEW."preferenceVersion" IS DISTINCT FROM OLD."preferenceVersion"
    OR NEW."outboxMessageId" IS DISTINCT FROM OLD."outboxMessageId"
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW."scheduledFor" IS DISTINCT FROM OLD."scheduledFor"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR OLD.status IN ('delivered', 'failed', 'cancelled')
    OR NEW.version <> OLD.version + 1
    OR NEW."attemptCount" < OLD."attemptCount"
  THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Notification delivery identity or terminal history is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION "protect_notification_recipient_history"()
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
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Notification recipient history cannot be deleted or truncated';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' OR NEW.version <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'New notification recipients must start active at version one';
    END IF;
  ELSIF NEW.id IS DISTINCT FROM OLD.id
    OR NEW."eventId" IS DISTINCT FROM OLD."eventId"
    OR NEW."audienceId" IS DISTINCT FROM OLD."audienceId"
    OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."labId" IS DISTINCT FROM OLD."labId"
    OR NEW."recipientAuthzVersion" IS DISTINCT FROM OLD."recipientAuthzVersion"
    OR NEW."recipientRole" IS DISTINCT FROM OLD."recipientRole"
    OR NEW."recipientMembershipRole" IS DISTINCT FROM OLD."recipientMembershipRole"
    OR NEW."materializedAt" IS DISTINCT FROM OLD."materializedAt"
    OR OLD.status = 'revoked'
    OR (OLD.status = 'active' AND NEW.status NOT IN ('active', 'revoked'))
    OR NEW.version <> OLD.version + 1
  THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Notification recipient provenance is immutable and updates must advance one version';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "NotificationPreference_history_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "NotificationPreference"
FOR EACH ROW EXECUTE FUNCTION "protect_notification_preference_history"();
CREATE TRIGGER "NotificationPreference_truncate_guard"
BEFORE TRUNCATE ON "NotificationPreference"
FOR EACH STATEMENT EXECUTE FUNCTION "protect_notification_preference_history"();

CREATE TRIGGER "NotificationDelivery_history_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "NotificationDelivery"
FOR EACH ROW EXECUTE FUNCTION "protect_notification_delivery_history"();
CREATE TRIGGER "NotificationDelivery_binding_guard"
BEFORE INSERT ON "NotificationDelivery"
FOR EACH ROW EXECUTE FUNCTION "validate_notification_delivery_binding"();
CREATE TRIGGER "NotificationDelivery_truncate_guard"
BEFORE TRUNCATE ON "NotificationDelivery"
FOR EACH STATEMENT EXECUTE FUNCTION "protect_notification_delivery_history"();

COMMIT;
