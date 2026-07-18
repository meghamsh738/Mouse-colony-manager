import { Building2 } from "lucide-react";

import { setActiveLabAction } from "@/app/lab-context-actions";
import type { ActorMembership } from "@/lib/capabilities";

export function ActiveLabSwitcher({
  activeLabId,
  memberships,
}: {
  activeLabId: string | null;
  memberships: ActorMembership[];
}) {
  if (memberships.length === 0) {
    return <p className="text-xs text-[var(--danger)]">No active lab membership</p>;
  }

  if (memberships.length === 1) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
        <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
        {memberships[0].labName}
      </p>
    );
  }

  return (
    <form action={setActiveLabAction} className="space-y-2">
      <label className="block text-xs font-medium text-[var(--muted)]" htmlFor="active-lab">
        Active lab
      </label>
      <div className="flex gap-2">
        <select className="min-w-0 flex-1" defaultValue={activeLabId ?? ""} id="active-lab" name="labId">
          {memberships.map((membership) => (
            <option key={membership.labId} value={membership.labId}>
              {membership.labName} ({membership.labCode})
            </option>
          ))}
        </select>
        <button className="table-action" type="submit">Switch</button>
      </div>
    </form>
  );
}
