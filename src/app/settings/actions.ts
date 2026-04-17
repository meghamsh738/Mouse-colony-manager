"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { updateRuleConfig } from "@/lib/colony-write";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { requireUser } from "@/lib/session";

const updateRuleSchema = z.object({
  ruleId: z.string().trim().min(1),
  valueInput: z.string(),
  criticalBlock: z.string().optional(),
});

export async function updateRuleConfigAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser();
  const parsed = updateRuleSchema.safeParse({
    ruleId: formData.get("ruleId"),
    valueInput: formData.get("valueInput") ?? "",
    criticalBlock: formData.get("criticalBlock") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose a rule value before saving.",
    };
  }

  const result = await updateRuleConfig(
    {
      ruleId: parsed.data.ruleId,
      valueInput: parsed.data.valueInput,
      criticalBlock: parsed.data.criticalBlock === "on",
    },
    { id: user.id, role: user.role },
  );

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidatePath("/");
  revalidatePath("/animals");
  revalidatePath("/breeding");
  revalidatePath("/cages");
  revalidatePath("/experiments");
  revalidatePath("/settings");

  return {
    status: "success",
    message: result.message,
  };
}
