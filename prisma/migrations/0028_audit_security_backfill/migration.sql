SET lock_timeout = '5s';
SET statement_timeout = '30min';

INSERT INTO "SecurityEvent" (
  id, "eventType", severity, outcome, "actorId", "actorRole", "scopeLabId", "correlationId", "dedupeKey",
  "subjectType", "subjectId", source, summary, "occurredAt"
)
SELECT
  'security-legacy-' || audit.id,
  CASE audit."entityType"
    WHEN 'user_invitation' THEN 'identity.legacy.invitation'
    WHEN 'user_role' THEN 'identity.legacy.role_change'
    ELSE 'identity.legacy.account_access'
  END,
  CASE audit."entityType"
    WHEN 'user_role' THEN 'critical'::"SecurityEventSeverity"
    WHEN 'user_access' THEN 'warning'::"SecurityEventSeverity"
    ELSE 'info'::"SecurityEventSeverity"
  END,
  'succeeded'::"SecurityEventOutcome",
  audit."actorId",
  CASE WHEN audit."actorId" IS NULL THEN 'system' ELSE 'legacy_unsnapshotted' END,
  NULL,
  NULL,
  'legacy-audit:' || audit.id,
  audit."entityType",
  audit."entityId",
  'legacy_audit_backfill',
  'Legacy identity governance event.',
  audit."timestamp"
FROM "AuditLog" audit
WHERE audit."entityType" IN ('user_invitation', 'user_role', 'user_access')
ON CONFLICT ("dedupeKey") DO NOTHING;

ALTER TABLE "AuditLog" VALIDATE CONSTRAINT "AuditLog_actorId_fkey";
ALTER TABLE "AuditLog" VALIDATE CONSTRAINT "AuditLog_labId_fkey";
ALTER TABLE "AuditLog" VALIDATE CONSTRAINT "AuditLog_commandReceiptId_fkey";
ALTER TABLE "AuditLog" VALIDATE CONSTRAINT "AuditLog_actorRole_nonempty_check";
ALTER TABLE "AuditLog" VALIDATE CONSTRAINT "AuditLog_requestId_nonempty_check";
ALTER TABLE "AuditLog" VALIDATE CONSTRAINT "AuditLog_command_context_check";

RESET statement_timeout;
RESET lock_timeout;
