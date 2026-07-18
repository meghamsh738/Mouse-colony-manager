CREATE UNIQUE INDEX "PrivilegedRoleChangeRequest_one_pending_per_target"
  ON "PrivilegedRoleChangeRequest" ("targetUserId")
  WHERE "status" = 'pending';
