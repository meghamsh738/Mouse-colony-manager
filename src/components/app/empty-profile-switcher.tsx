import { Check, RefreshCw } from "lucide-react";

import { switchEmptyProfileAction } from "@/app/profile-actions";
import { EMPTY_PROFILES } from "@/lib/empty-profile-config";
import { cn } from "@/lib/utils";

export function EmptyProfileSwitcher({ currentUserId }: { currentUserId?: string }) {
  return (
    <section className="profile-switcher" aria-label="Switch profile">
      <div className="profile-switcher-heading">
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Switch profile
      </div>
      <div className="profile-switch-list">
        {EMPTY_PROFILES.map((profile) => {
          const isCurrent = profile.id === currentUserId;

          return (
            <form action={switchEmptyProfileAction} key={profile.id}>
              <input name="profileId" type="hidden" value={profile.id} />
              <button
                aria-current={isCurrent ? "true" : undefined}
                className={cn("profile-switch-row", isCurrent && "is-active")}
                disabled={isCurrent}
                type="submit"
              >
                <span className="profile-switch-copy">
                  <strong>{profile.name}</strong>
                  <small>{profile.scope}</small>
                </span>
                {isCurrent ? <Check className="h-4 w-4" aria-label="Current profile" /> : null}
              </button>
            </form>
          );
        })}
      </div>
    </section>
  );
}
