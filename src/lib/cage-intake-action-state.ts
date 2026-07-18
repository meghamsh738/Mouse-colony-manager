import type { FormActionState } from "@/lib/form-state";

export type CageIntakeDraftActionState = FormActionState & {
  draftId?: string;
  draftVersion?: number;
  resumeUrl?: string;
};

export const initialCageIntakeDraftActionState: CageIntakeDraftActionState = { status: "idle" };
