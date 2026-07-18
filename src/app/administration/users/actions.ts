"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  approvePrivilegedRoleChange,
  changeRoutineUserRole,
  createUserInvitation,
  rejectPrivilegedRoleChange,
  resendUserInvitation,
  revokeUserInvitation,
  requestPrivilegedRoleChange,
  setUserActiveState,
} from "@/lib/identity-governance";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { requireUser } from "@/lib/session";

const invitationSchema = z.discriminatedUnion("targetRole", [
  z.object({ targetRole: z.literal("cmu_staff"), email: z.string().trim().email(), name: z.string().trim().max(120).optional() }),
  z.object({
    targetRole: z.literal("lab_user"), email: z.string().trim().email(), name: z.string().trim().max(120).optional(),
    labId: z.string().min(1), membershipRole: z.enum(["owner", "manager", "staff", "viewer"]),
  }),
]);

const roleRequestSchema = z.object({
  targetUserId: z.string().min(1),
  requestedRole: z.enum(["it_head", "facility_admin", "cmu_staff", "lab_user"]),
  reason: z.string().trim().min(5).max(350),
});

const routineRoleSchema = roleRequestSchema.extend({
  requestedRole: z.enum(["cmu_staff", "lab_user"]),
});

const activeStateSchema = z.object({
  targetUserId: z.string().min(1),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
  reason: z.string().trim().min(5).max(350),
});

const invitationIdSchema = z.object({ invitationId: z.string().min(1) });
const invitationRevocationSchema = invitationIdSchema.extend({ reason: z.string().trim().min(5).max(400) });
const roleRejectionSchema = z.object({
  requestId: z.string().min(1),
  reason: z.string().trim().min(5).max(350),
});

async function governanceActor() {
  const user = await requireUser({ capability: "users:manage" });
  return { id: user.id, canonicalRole: user.canonicalRole, authzVersion: user.authzVersion };
}

export async function createInvitationAction(previousState: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void previousState;
  const actor = await governanceActor();
  const targetRole = formData.get("targetRole");
  const parsed = invitationSchema.safeParse({
    targetRole, email: formData.get("email"), name: formData.get("name") || undefined,
    labId: targetRole === "lab_user" ? formData.get("labId") : undefined,
    membershipRole: targetRole === "lab_user" ? formData.get("membershipRole") : undefined,
  });
  if (!parsed.success) return { status: "error", message: "Enter a valid email and all required invitation details." };
  const result = await createUserInvitation(parsed.data, actor);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/administration/users");
  return { status: "success", message: `${result.message} Activation link: /activate?token=${result.token}` };
}

export async function revokeInvitationAction(previousState: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void previousState;
  const actor = await governanceActor();
  const parsed = invitationRevocationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Provide a revocation reason." };
  const result = await revokeUserInvitation(parsed.data.invitationId, parsed.data.reason, actor);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/administration/users");
  return { status: "success", message: result.message };
}

export async function resendInvitationAction(previousState: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void previousState;
  const actor = await governanceActor();
  const parsed = invitationIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Invitation not found." };
  const result = await resendUserInvitation(parsed.data.invitationId, actor);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/administration/users");
  return { status: "success", message: `${result.message} Activation link: /activate?token=${result.token}` };
}

export async function requestRoleAction(previousState: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void previousState;
  const actor = await governanceActor();
  const parsed = roleRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose a user and privileged role, then provide a reason." };
  const result = await requestPrivilegedRoleChange(parsed.data, actor);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/administration/users");
  revalidatePath("/approvals");
  return { status: "success", message: result.message };
}

export async function approveRoleAction(previousState: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void previousState;
  const actor = await governanceActor();
  const requestId = z.string().min(1).safeParse(formData.get("requestId"));
  if (!requestId.success) return { status: "error", message: "Role request not found." };
  const result = await approvePrivilegedRoleChange(requestId.data, actor);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/administration/users");
  revalidatePath("/approvals");
  return { status: "success", message: result.message };
}

export async function rejectRoleAction(previousState: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void previousState;
  const actor = await governanceActor();
  const parsed = roleRejectionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Provide a rejection reason." };
  const result = await rejectPrivilegedRoleChange(parsed.data.requestId, parsed.data.reason, actor);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/administration/users");
  revalidatePath("/approvals");
  return { status: "success", message: result.message };
}

export async function changeRoutineRoleAction(previousState: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void previousState;
  const actor = await governanceActor();
  const parsed = routineRoleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose a user and routine role, then provide a reason." };
  const result = await changeRoutineUserRole(parsed.data, actor);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/administration/users");
  return { status: "success", message: result.message };
}

export async function setUserActiveStateAction(previousState: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void previousState;
  const actor = await governanceActor();
  const parsed = activeStateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Provide a reason for the account status change." };
  const result = await setUserActiveState(parsed.data, actor);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/administration/users");
  revalidatePath("/approvals");
  return { status: "success", message: result.message };
}
