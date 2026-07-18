"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import {
  createLab,
  setLabActiveState,
  setLabMembershipActiveState,
  updateLabDetails,
  upsertLabMembership,
} from "@/lib/lab-administration";
import { requireUser } from "@/lib/session";

const createLabSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(20),
  billingContact: z.string().trim().max(254).optional(),
  notes: z.string().trim().max(2_000).optional(),
});
const updateLabSchema = createLabSchema.omit({ code: true }).extend({ labId: z.string().min(1) });
const labStateSchema = z.object({
  labId: z.string().min(1),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
  reason: z.string().trim().min(5).max(350),
});
const membershipSchema = z.object({
  labId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["owner", "manager", "staff", "viewer"]),
  reason: z.string().trim().min(5).max(350),
});
const membershipStateSchema = z.object({
  membershipId: z.string().min(1),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
  reason: z.string().trim().min(5).max(350),
});

async function labActor() {
  const actor = await requireUser({ capability: "labs:manage" });
  return {
    id: actor.id,
    canonicalRole: actor.canonicalRole,
    authzVersion: actor.authzVersion,
    activeLabId: actor.activeLabId,
    activeMembership: actor.activeMembership,
  };
}

function revalidateLabAdministration() {
  revalidatePath("/administration/labs");
  revalidatePath("/administration/users");
  revalidatePath("/");
}

function resultState(result: { ok: boolean; message: string }): FormActionState {
  return { status: result.ok ? "success" : "error", message: result.message };
}

export async function createLabAction(_: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await labActor();
  const parsed = createLabSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Enter a valid lab name and code." };
  const result = await createLab(parsed.data, actor);
  if (result.ok) revalidateLabAdministration();
  return resultState(result);
}

export async function updateLabDetailsAction(_: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await labActor();
  const parsed = updateLabSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Review the lab details." };
  const result = await updateLabDetails(parsed.data, actor);
  if (result.ok) revalidateLabAdministration();
  return resultState(result);
}

export async function setLabActiveStateAction(_: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await labActor();
  const parsed = labStateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Provide a reason for the lab status change." };
  const result = await setLabActiveState(parsed.data, actor);
  if (result.ok) revalidateLabAdministration();
  return resultState(result);
}

export async function upsertLabMembershipAction(_: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await labActor();
  const parsed = membershipSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose an active lab, user, membership role, and reason." };
  const result = await upsertLabMembership(parsed.data, actor);
  if (result.ok) revalidateLabAdministration();
  return resultState(result);
}

export async function setLabMembershipActiveStateAction(_: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await labActor();
  const parsed = membershipStateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Provide a reason for the membership change." };
  const result = await setLabMembershipActiveState(parsed.data, actor);
  if (result.ok) revalidateLabAdministration();
  return resultState(result);
}
