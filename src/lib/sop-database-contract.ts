import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type SopDatabaseClient = Prisma.TransactionClient | typeof prisma;

export async function assertSopGovernanceDatabaseReady(client: SopDatabaseClient) {
  const [contract] = await (client as Prisma.TransactionClient).$queryRaw<Array<{ ready: boolean }>>(Prisma.sql`
    SELECT
      (
        SELECT COUNT(*) = 6
        FROM pg_proc procedure
        JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = current_schema()
          AND procedure.proname IN (
            'sop_create_document_version',
            'sop_create_version',
            'sop_decide_version',
            'sop_assign_version',
            'sop_revoke_assignment',
            'sop_acknowledge_assignment'
          )
          AND procedure.prosecdef
          AND NOT has_function_privilege('public', procedure.oid, 'EXECUTE')
      )
      AND (
        SELECT COUNT(*) = 9
        FROM pg_trigger trigger
        JOIN pg_class relation ON relation.oid = trigger.tgrelid
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = current_schema()
          AND NOT trigger.tgisinternal
          AND trigger.tgname IN (
            'SopDocument_identity_current_version_guard',
            'SopVersion_insert_guard',
            'SopVersion_append_only',
            'SopVersionApproval_insert_guard',
            'SopVersionApproval_append_only',
            'SopAssignment_write_guard',
            'SopAcknowledgement_binding_guard',
            'CommandReceipt_principal_stamp',
            'CommandReceipt_sop_identity_guard'
          )
      ) AS ready
  `);
  if (!contract?.ready) {
    throw new Error("SOP governance database contract is missing. Apply the migration chain; Prisma db push is not sufficient.");
  }
}
