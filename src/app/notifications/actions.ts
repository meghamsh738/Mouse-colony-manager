"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { executeNotificationRecipientAction, updateNotificationPreference } from "@/lib/notification-write";
import { requireUser } from "@/lib/session";

const notificationActionSchema = z.object({
  recipientId: z.string().trim().min(1),
  action: z.enum(["read", "acknowledge", "resolve"]),
  expectedVersion: z.coerce.number().int().min(1),
  idempotencyKey: z.string().trim().min(16),
  requestId: z.string().trim().min(16),
});

const notificationPreferenceSchema = z.object({
  categoryKey: z.string().trim().min(1),
  inAppEnabled: z.string().optional(),
  emailMode: z.enum(["off", "daily_digest", "weekly_digest"]),
  digestHourUtc: z.coerce.number().int().min(0).max(23),
  digestDayOfWeek: z.coerce.number().int().min(0).max(6),
  expectedVersion: z.coerce.number().int().min(0),
  idempotencyKey: z.string().trim().min(16),
  requestId: z.string().trim().min(16),
});

export async function updateNotificationRecipientAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "notifications:read" });
  const parsed = notificationActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Refresh the inbox and try that action again." };
  const result = await executeNotificationRecipientAction({ actor, ...parsed.data });
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/");
  revalidatePath("/notifications");
  const payload = result.result && typeof result.result === "object" && !Array.isArray(result.result)
    ? result.result as { message?: string }
    : null;
  return { status: "success", message: payload?.message ?? "Notification updated." };
}

export async function updateNotificationPreferenceAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "notifications:read" });
  const parsed = notificationPreferenceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose valid notification delivery settings." };
  const result = await updateNotificationPreference({
    actor,
    ...parsed.data,
    inAppEnabled: parsed.data.inAppEnabled === "on",
  });
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/");
  revalidatePath("/notifications");
  const payload = result.result && typeof result.result === "object" && !Array.isArray(result.result)
    ? result.result as { message?: string }
    : null;
  return { status: "success", message: payload?.message ?? "Delivery preference saved." };
}
