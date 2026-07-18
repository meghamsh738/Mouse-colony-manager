"use client";

import { useActionState } from "react";

import { updateNotificationRecipientAction } from "@/app/notifications/actions";
import { Button } from "@/components/ui/button";
import { initialFormActionState } from "@/lib/form-state";
import type { NotificationItem } from "@/lib/types";

export function NotificationRecipientActions({ notification }: { notification: NotificationItem }) {
  const [state, formAction, pending] = useActionState(updateNotificationRecipientAction, initialFormActionState);

  return (
    <form
      action={formAction}
      className="flex min-w-0 flex-wrap items-center gap-2"
      onSubmit={(event) => {
        const identity = crypto.randomUUID();
        const form = event.currentTarget;
        (form.elements.namedItem("idempotencyKey") as HTMLInputElement).value = `notification:${identity}`;
        (form.elements.namedItem("requestId") as HTMLInputElement).value = `notification:request:${identity}`;
      }}
    >
      <input name="recipientId" type="hidden" value={notification.recipientId} />
      <input name="expectedVersion" type="hidden" value={notification.version} />
      <input name="idempotencyKey" type="hidden" value="notification:pending" />
      <input name="requestId" type="hidden" value="notification:request:pending" />
      {!notification.readAt ? (
        <Button disabled={pending} name="action" size="sm" type="submit" value="read" variant="subtle">Read</Button>
      ) : null}
      {!notification.acknowledgedAt ? (
        <Button disabled={pending} name="action" size="sm" type="submit" value="acknowledge" variant="secondary">Acknowledge</Button>
      ) : null}
      <Button disabled={pending} name="action" size="sm" type="submit" value="resolve" variant="ghost">Resolve</Button>
      {state.message ? (
        <span className={`wrap-value text-xs ${state.status === "error" ? "text-red-700" : "text-emerald-700"}`} role="status">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
