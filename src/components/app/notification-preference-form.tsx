"use client";

import { Save } from "lucide-react";
import { useActionState, useState } from "react";

import { updateNotificationPreferenceAction } from "@/app/notifications/actions";
import { Button } from "@/components/ui/button";
import { initialFormActionState } from "@/lib/form-state";
import type { NotificationPreference } from "@/lib/types";

const dayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function NotificationPreferenceForm({ preference }: { preference: NotificationPreference }) {
  const [state, formAction, pending] = useActionState(updateNotificationPreferenceAction, initialFormActionState);
  const [emailMode, setEmailMode] = useState(preference.emailMode);

  return (
    <form
      action={formAction}
      className="grid min-w-0 gap-3 md:grid-cols-[minmax(8rem,0.8fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_auto] md:items-end"
      onSubmit={(event) => {
        const identity = crypto.randomUUID();
        const form = event.currentTarget;
        (form.elements.namedItem("idempotencyKey") as HTMLInputElement).value = `notification-preference:${identity}`;
        (form.elements.namedItem("requestId") as HTMLInputElement).value = `notification-preference:request:${identity}`;
      }}
    >
      <input name="categoryKey" type="hidden" value={preference.categoryKey} />
      <input name="expectedVersion" type="hidden" value={preference.version} />
      <input name="idempotencyKey" type="hidden" value="notification-preference:pending" />
      <input name="requestId" type="hidden" value="notification-preference:request:pending" />

      <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-[var(--ink)]">
        <input defaultChecked={preference.inAppEnabled} name="inAppEnabled" type="checkbox" />
        In-app
      </label>

      <label className="grid gap-1 text-xs font-semibold uppercase text-[var(--muted)]">
        Email
        <select
          className="min-h-11 rounded-md border border-[var(--line)] bg-white px-3 text-sm font-normal normal-case text-[var(--ink)]"
          name="emailMode"
          onChange={(event) => setEmailMode(event.target.value as NotificationPreference["emailMode"])}
          value={emailMode}
        >
          <option value="off">Off</option>
          <option value="daily_digest">Daily digest</option>
          <option value="weekly_digest">Weekly digest</option>
        </select>
      </label>

      <div className="grid min-w-0 grid-cols-2 gap-2">
        <label className="grid gap-1 text-xs font-semibold uppercase text-[var(--muted)]">
          Hour UTC
          <input
            className="min-h-11 min-w-0 rounded-md border border-[var(--line)] bg-white px-3 text-sm font-normal text-[var(--ink)] disabled:bg-slate-100"
            defaultValue={preference.digestHourUtc}
            max={23}
            min={0}
            name="digestHourUtc"
            type="number"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold uppercase text-[var(--muted)]">
          Digest day
          <select
            className="min-h-11 min-w-0 rounded-md border border-[var(--line)] bg-white px-2 text-sm font-normal normal-case text-[var(--ink)] disabled:bg-slate-100"
            defaultValue={preference.digestDayOfWeek}
            name="digestDayOfWeek"
          >
            {dayLabels.map((label, index) => <option key={label} value={index}>{label}</option>)}
          </select>
        </label>
      </div>

      <Button disabled={pending} size="sm" type="submit" variant="secondary">
        <Save aria-hidden="true" className="size-4" />
        Save
      </Button>
      {preference.urgentAlwaysOn ? (
        <p className="wrap-value text-xs text-amber-800 md:col-span-4">Urgent welfare alerts remain in-app and email immediately.</p>
      ) : null}
      {state.message ? (
        <p className={`wrap-value text-xs md:col-span-4 ${state.status === "error" ? "text-red-700" : "text-emerald-700"}`} role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
