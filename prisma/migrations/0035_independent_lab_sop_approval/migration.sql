BEGIN;

CREATE OR REPLACE FUNCTION "sop_actor_can_approve_version"(actor_id TEXT, sop_id TEXT, version_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "SopVersion" version
    JOIN "SopDocument" document ON document.id = version."sopId"
    JOIN "User" actor ON actor.id = actor_id
    WHERE version.id = version_id
      AND version."sopId" = sop_id
      AND version."createdById" <> actor.id
      AND actor.active
      AND (
        (
          document.scope = 'facility'
          AND actor.role IN ('facility_admin', 'admin')
        )
        OR (
          document.scope = 'lab'
          AND actor.role = 'lab_user'
          AND EXISTS (
            SELECT 1
            FROM "LabMembership" membership
            JOIN "Lab" lab ON lab.id = membership."labId"
            WHERE membership."userId" = actor.id
              AND membership."labId" = document."labId"
              AND membership.active
              AND membership.role IN ('owner', 'manager')
              AND lab.active
          )
        )
      )
  );
$$;

COMMIT;
