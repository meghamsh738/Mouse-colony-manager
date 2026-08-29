import { Prisma, type FacilityDuty } from "@prisma/client";

type DutyQueryClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function getActiveFacilityDutiesAtDatabaseTime(
  database: DutyQueryClient,
  userId: string,
): Promise<FacilityDuty[]> {
  const rows = await database.$queryRaw<Array<{ duty: FacilityDuty }>>(Prisma.sql`
    SELECT assignment.duty
    FROM "FacilityDutyAssignment" assignment
    JOIN "User" target ON target.id = assignment."userId"
    WHERE assignment."userId" = ${userId}
      AND target.active
      AND target.role <> 'it_head'::"UserRole"
      AND assignment."revokedAt" IS NULL
      AND assignment."validFrom" <= CURRENT_TIMESTAMP
      AND assignment."validUntil" > CURRENT_TIMESTAMP
    ORDER BY assignment.duty
  `);
  return [...new Set(rows.map((row) => row.duty))];
}
