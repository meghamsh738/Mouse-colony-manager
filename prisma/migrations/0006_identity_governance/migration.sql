CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');
CREATE TYPE "PrivilegedRoleChangeStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired');

CREATE TABLE "UserInvitation" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "tokenHash" TEXT NOT NULL,
  "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
  "targetRole" "UserRole" NOT NULL,
  "labId" TEXT,
  "membershipRole" "LabMembershipRole",
  "invitedById" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrivilegedRoleChangeRequest" (
  "id" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "requestedRole" "UserRole" NOT NULL,
  "status" "PrivilegedRoleChangeStatus" NOT NULL DEFAULT 'pending',
  "reason" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "approvedById" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrivilegedRoleChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserInvitation_tokenHash_key" ON "UserInvitation"("tokenHash");
CREATE INDEX "UserInvitation_email_status_idx" ON "UserInvitation"("email", "status");
CREATE INDEX "UserInvitation_labId_status_idx" ON "UserInvitation"("labId", "status");
CREATE INDEX "UserInvitation_expiresAt_status_idx" ON "UserInvitation"("expiresAt", "status");
CREATE INDEX "PrivilegedRoleChangeRequest_targetUserId_status_idx" ON "PrivilegedRoleChangeRequest"("targetUserId", "status");
CREATE INDEX "PrivilegedRoleChangeRequest_requestedById_status_idx" ON "PrivilegedRoleChangeRequest"("requestedById", "status");
CREATE INDEX "PrivilegedRoleChangeRequest_expiresAt_status_idx" ON "PrivilegedRoleChangeRequest"("expiresAt", "status");

ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_labId_fkey"
  FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivilegedRoleChangeRequest" ADD CONSTRAINT "PrivilegedRoleChangeRequest_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivilegedRoleChangeRequest" ADD CONSTRAINT "PrivilegedRoleChangeRequest_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivilegedRoleChangeRequest" ADD CONSTRAINT "PrivilegedRoleChangeRequest_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
