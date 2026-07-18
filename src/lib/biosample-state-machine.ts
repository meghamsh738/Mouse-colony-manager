import type { SampleStatus } from "@/lib/types";

const SAMPLE_STATUS_TRANSITIONS: Record<SampleStatus, readonly SampleStatus[]> = {
  collected: ["collected", "stored", "discarded"],
  stored: ["stored", "allocated", "consumed", "discarded"],
  allocated: ["allocated", "stored", "consumed", "discarded"],
  consumed: ["consumed"],
  discarded: ["discarded"],
};

export function validateBiosampleTransition(from: SampleStatus, to: SampleStatus) {
  return SAMPLE_STATUS_TRANSITIONS[from].includes(to)
    ? null
    : `Biosample status cannot move from ${from} to ${to}.`;
}

export function validateBiosampleStorage(input: {
  status: SampleStatus;
  storageLocation: string | null | undefined;
  quantityLabel: string | null | undefined;
}) {
  if (["stored", "allocated"].includes(input.status) && !input.storageLocation) {
    return "Stored or allocated biosamples require a storage location.";
  }

  if (input.status === "allocated" && !input.quantityLabel) {
    return "Allocated biosamples require a quantity or unit label.";
  }

  return null;
}
