BEGIN;

CREATE TYPE "NotificationAudienceType" AS ENUM ('user', 'lab_members', 'facility_role');
CREATE TYPE "NotificationRecipientStatus" AS ENUM ('active', 'revoked');

CREATE TABLE "NotificationEvent" (
  id TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  source TEXT NOT NULL,
  "labId" TEXT,
  "categoryKey" TEXT NOT NULL,
  severity "AlertSeverity" NOT NULL,
  message TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "deepLink" TEXT NOT NULL,
  "actionLabel" TEXT NOT NULL,
  urgent BOOLEAN NOT NULL DEFAULT false,
  status "AlertStatus" NOT NULL DEFAULT 'open',
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  version INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY (id),
  CONSTRAINT "NotificationEvent_sourceKey_key" UNIQUE ("sourceKey"),
  CONSTRAINT "NotificationEvent_version_check" CHECK (version >= 1),
  CONSTRAINT "NotificationEvent_source_check" CHECK (char_length(btrim(source)) BETWEEN 1 AND 80),
  CONSTRAINT "NotificationEvent_category_check" CHECK (char_length(btrim("categoryKey")) BETWEEN 1 AND 80),
  CONSTRAINT "NotificationEvent_message_check" CHECK (char_length(btrim(message)) BETWEEN 1 AND 2000),
  CONSTRAINT "NotificationEvent_entity_check" CHECK (
    char_length(btrim("entityType")) BETWEEN 1 AND 80
    AND char_length(btrim("entityId")) BETWEEN 1 AND 200
  ),
  CONSTRAINT "NotificationEvent_link_check" CHECK (
    char_length(btrim("deepLink")) BETWEEN 1 AND 500
    AND left("deepLink", 1) = '/'
    AND char_length(btrim("actionLabel")) BETWEEN 1 AND 80
  ),
  CONSTRAINT "NotificationEvent_resolution_check" CHECK (
    (status = 'resolved' AND "resolvedAt" IS NOT NULL AND "resolvedAt" >= "occurredAt")
    OR (status IN ('open', 'acknowledged') AND "resolvedAt" IS NULL)
  )
);

CREATE TABLE "NotificationAudience" (
  id TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "audienceType" "NotificationAudienceType" NOT NULL,
  "audienceKey" TEXT NOT NULL,
  "userId" TEXT,
  "labId" TEXT,
  "facilityRole" "UserRole",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NotificationAudience_pkey" PRIMARY KEY (id),
  CONSTRAINT "NotificationAudience_eventId_audienceKey_key" UNIQUE ("eventId", "audienceKey"),
  CONSTRAINT "NotificationAudience_payload_check" CHECK (
    (
      "audienceType" = 'user'
      AND "userId" IS NOT NULL
      AND "labId" IS NULL
      AND "facilityRole" IS NULL
      AND "audienceKey" = 'user:' || "userId"
    )
    OR (
      "audienceType" = 'lab_members'
      AND "userId" IS NULL
      AND "labId" IS NOT NULL
      AND "facilityRole" IS NULL
      AND "audienceKey" = 'lab:' || "labId"
    )
    OR (
      "audienceType" = 'facility_role'
      AND "userId" IS NULL
      AND "labId" IS NULL
      AND "facilityRole" IN ('it_head', 'facility_admin', 'cmu_staff')
      AND "audienceKey" = 'role:' || "facilityRole"::text
    )
  )
);

CREATE TABLE "NotificationRecipient" (
  id TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "audienceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "labId" TEXT,
  "recipientAuthzVersion" INTEGER NOT NULL,
  "recipientRole" "UserRole" NOT NULL,
  "recipientMembershipRole" "LabMembershipRole",
  status "NotificationRecipientStatus" NOT NULL DEFAULT 'active',
  "materializedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "revokeReason" TEXT,
  "readAt" TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  version INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT "NotificationRecipient_pkey" PRIMARY KEY (id),
  CONSTRAINT "NotificationRecipient_eventId_userId_key" UNIQUE ("eventId", "userId"),
  CONSTRAINT "NotificationRecipient_version_check" CHECK (version >= 1),
  CONSTRAINT "NotificationRecipient_status_check" CHECK (
    (
      status = 'active'
      AND "revokedAt" IS NULL
      AND "revokeReason" IS NULL
    )
    OR (
      status = 'revoked'
      AND "revokedAt" IS NOT NULL
      AND char_length(btrim("revokeReason")) BETWEEN 3 AND 500
      AND "revokedAt" >= "materializedAt"
    )
  ),
  CONSTRAINT "NotificationRecipient_action_timestamps_check" CHECK (
    ("readAt" IS NULL OR "readAt" >= "materializedAt")
    AND ("acknowledgedAt" IS NULL OR ("readAt" IS NOT NULL AND "acknowledgedAt" >= "readAt"))
    AND ("resolvedAt" IS NULL OR ("acknowledgedAt" IS NOT NULL AND "resolvedAt" >= "acknowledgedAt"))
  )
);

CREATE INDEX "NotificationEvent_labId_status_occurredAt_idx"
  ON "NotificationEvent" ("labId", status, "occurredAt");
CREATE INDEX "NotificationEvent_categoryKey_status_occurredAt_idx"
  ON "NotificationEvent" ("categoryKey", status, "occurredAt");
CREATE INDEX "NotificationEvent_entityType_entityId_idx"
  ON "NotificationEvent" ("entityType", "entityId");
CREATE INDEX "NotificationAudience_userId_eventId_idx" ON "NotificationAudience" ("userId", "eventId");
CREATE INDEX "NotificationAudience_labId_eventId_idx" ON "NotificationAudience" ("labId", "eventId");
CREATE INDEX "NotificationAudience_facilityRole_eventId_idx" ON "NotificationAudience" ("facilityRole", "eventId");
CREATE INDEX "NotificationRecipient_userId_status_materializedAt_idx"
  ON "NotificationRecipient" ("userId", status, "materializedAt");
CREATE INDEX "NotificationRecipient_labId_status_materializedAt_idx"
  ON "NotificationRecipient" ("labId", status, "materializedAt");
CREATE INDEX "NotificationRecipient_audienceId_idx" ON "NotificationRecipient" ("audienceId");

ALTER TABLE "NotificationEvent"
  ADD CONSTRAINT "NotificationEvent_labId_fkey"
    FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationAudience"
  ADD CONSTRAINT "NotificationAudience_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "NotificationEvent"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "NotificationAudience_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "NotificationAudience_labId_fkey"
    FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationRecipient"
  ADD CONSTRAINT "NotificationRecipient_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "NotificationEvent"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "NotificationRecipient_audienceId_fkey"
    FOREIGN KEY ("audienceId") REFERENCES "NotificationAudience"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "NotificationRecipient_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "NotificationRecipient_labId_fkey"
    FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "validate_notification_recipient_binding"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  event_row "NotificationEvent"%ROWTYPE;
  audience_row "NotificationAudience"%ROWTYPE;
  user_row "User"%ROWTYPE;
  membership_row "LabMembership"%ROWTYPE;
BEGIN
  IF NEW.status = 'revoked' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO event_row FROM "NotificationEvent" WHERE id = NEW."eventId";
  SELECT * INTO audience_row FROM "NotificationAudience" WHERE id = NEW."audienceId";
  SELECT * INTO user_row FROM "User" WHERE id = NEW."userId";

  IF event_row.id IS NULL
    OR audience_row.id IS NULL
    OR audience_row."eventId" IS DISTINCT FROM event_row.id
    OR NEW."labId" IS DISTINCT FROM event_row."labId"
    OR user_row.id IS NULL
    OR NOT user_row.active
    OR NEW."recipientAuthzVersion" IS DISTINCT FROM user_row."authzVersion"
    OR NEW."recipientRole" IS DISTINCT FROM user_row.role
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Notification recipient identity is not current or event-scoped';
  END IF;

  IF event_row."labId" IS NOT NULL THEN
    SELECT * INTO membership_row
    FROM "LabMembership"
    WHERE "labId" = event_row."labId" AND "userId" = NEW."userId" AND active;
  END IF;

  IF audience_row."audienceType" = 'user' THEN
    IF audience_row."userId" IS DISTINCT FROM NEW."userId"
      OR (
        event_row."labId" IS NOT NULL
        AND (membership_row.id IS NULL OR NEW."recipientMembershipRole" IS DISTINCT FROM membership_row.role)
      )
      OR (event_row."labId" IS NULL AND NEW."recipientMembershipRole" IS NOT NULL)
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'User notification recipient does not match its audience';
    END IF;
  ELSIF audience_row."audienceType" = 'lab_members' THEN
    IF audience_row."labId" IS DISTINCT FROM event_row."labId"
      OR membership_row.id IS NULL
      OR NEW."recipientMembershipRole" IS DISTINCT FROM membership_row.role
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Lab notification recipient is not an active member';
    END IF;
  ELSIF audience_row."audienceType" = 'facility_role' THEN
    IF NEW."recipientMembershipRole" IS NOT NULL
      OR NOT (
        (audience_row."facilityRole" = 'facility_admin' AND user_row.role IN ('facility_admin', 'admin'))
        OR (audience_row."facilityRole" = 'cmu_staff' AND user_row.role IN ('cmu_staff', 'colony_manager'))
        OR (audience_row."facilityRole" = 'it_head' AND user_row.role = 'it_head')
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Facility notification recipient does not hold the audience role';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE FUNCTION "protect_notification_event_history"()
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
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Notification event history cannot be deleted or truncated';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW."sourceKey" IS DISTINCT FROM OLD."sourceKey"
    OR NEW.source IS DISTINCT FROM OLD.source
    OR NEW."labId" IS DISTINCT FROM OLD."labId"
    OR NEW."categoryKey" IS DISTINCT FROM OLD."categoryKey"
    OR NEW."entityType" IS DISTINCT FROM OLD."entityType"
    OR NEW."entityId" IS DISTINCT FROM OLD."entityId"
    OR NEW."occurredAt" IS DISTINCT FROM OLD."occurredAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW.version <> OLD.version + 1
  THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Notification event identity is immutable and updates must advance one version';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION "protect_notification_audience_history"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN CASE WHEN TG_OP = 'TRUNCATE' THEN NULL WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Notification audience history is append-only';
END
$$;

CREATE FUNCTION "protect_notification_recipient_history"()
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
    OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."labId" IS DISTINCT FROM OLD."labId"
    OR NEW."materializedAt" IS DISTINCT FROM OLD."materializedAt"
    OR NEW.version <> OLD.version + 1
  THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Notification recipient identity is immutable and updates must advance one version';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "NotificationEvent_history_guard"
BEFORE UPDATE OR DELETE ON "NotificationEvent"
FOR EACH ROW EXECUTE FUNCTION "protect_notification_event_history"();
CREATE TRIGGER "NotificationEvent_truncate_guard"
BEFORE TRUNCATE ON "NotificationEvent"
FOR EACH STATEMENT EXECUTE FUNCTION "protect_notification_event_history"();

CREATE TRIGGER "NotificationAudience_history_guard"
BEFORE UPDATE OR DELETE ON "NotificationAudience"
FOR EACH ROW EXECUTE FUNCTION "protect_notification_audience_history"();
CREATE TRIGGER "NotificationAudience_truncate_guard"
BEFORE TRUNCATE ON "NotificationAudience"
FOR EACH STATEMENT EXECUTE FUNCTION "protect_notification_audience_history"();

CREATE TRIGGER "NotificationRecipient_history_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "NotificationRecipient"
FOR EACH ROW EXECUTE FUNCTION "protect_notification_recipient_history"();
CREATE TRIGGER "NotificationRecipient_binding_guard"
BEFORE INSERT OR UPDATE ON "NotificationRecipient"
FOR EACH ROW EXECUTE FUNCTION "validate_notification_recipient_binding"();
CREATE TRIGGER "NotificationRecipient_truncate_guard"
BEFORE TRUNCATE ON "NotificationRecipient"
FOR EACH STATEMENT EXECUTE FUNCTION "protect_notification_recipient_history"();

COMMIT;
