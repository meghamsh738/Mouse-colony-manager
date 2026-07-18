"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { acceptUserInvitation } from "@/lib/identity-governance";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";

const activationSchema = z.object({
  token: z.string().min(32),
  name: z.string().trim().min(2).max(120),
  password: z.string().min(12).max(200),
});

export async function activateAccountAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const parsed = activationSchema.safeParse({
    token: formData.get("token"),
    name: formData.get("name"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { status: "error", message: "Enter your name and a password with at least 12 characters." };
  }

  const result = await acceptUserInvitation(parsed.data);

  if (!result.ok) {
    return { status: "error", message: result.message };
  }

  redirect("/login?activated=1");
}
