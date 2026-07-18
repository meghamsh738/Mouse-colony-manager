import { z } from "zod";

import type { CageDraft, Sex } from "@/lib/types";

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
});

export type CageIntakeDraftMode = "new" | "wean" | "purchase";

export type CageIntakeDraftPurchaseRow = {
  rowId: string;
  sourceAnimalId: string;
  sex: Sex;
  strainId: string;
  dob: string;
  ageWeeks: string;
  healthNotes: string;
};

export type CageIntakeDraftSubject = {
  id: string;
  label: string;
  sex: Sex;
  strainId: string;
  strainLabel: string;
  purchaseRow?: CageIntakeDraftPurchaseRow;
};

export type CageIntakeDraftPayload = {
  schemaVersion: 1;
  mode: CageIntakeDraftMode;
  litterId?: string;
  litterVersion?: number;
  step: 1 | 2 | 3;
  labId: string;
  operationDate: string;
  reason: string;
  selectedAnimalIds: string[];
  femaleCount: number;
  maleCount: number;
  weanStrainId: string;
  vendor: string;
  orderReference: string;
  disposition: "holding" | "quarantine";
  intakeNotes: string;
  purchaseRows: CageIntakeDraftPurchaseRow[];
  subjects: CageIntakeDraftSubject[];
  cages: CageDraft[];
  assignments: Record<string, string>;
  command: unknown;
};

const purchaseRowSchema = z.object({
  rowId: z.string().min(1),
  sourceAnimalId: z.string(),
  sex: z.enum(["male", "female", "unknown"]),
  strainId: z.string(),
  dob: z.union([z.literal(""), dateOnlySchema]),
  ageWeeks: z.string(),
  healthNotes: z.string(),
});

const cageDraftSchema = z.object({
  clientId: z.string().min(1),
  labId: z.string().min(1),
  roomId: z.string().min(1),
  rackId: z.string().min(1),
  cageNumber: z.string(),
  barcode: z.string().optional(),
  capacityOverride: z.number().int().min(1).max(6).nullable().optional(),
  status: z.enum(["active", "breeding", "quarantine", "experiment"]),
  chargeCategoryId: z.string().optional(),
  startDate: dateOnlySchema,
  notes: z.string().optional(),
});

export const cageIntakeDraftPayloadSchema: z.ZodType<CageIntakeDraftPayload> = z.object({
  schemaVersion: z.literal(1),
  mode: z.enum(["new", "wean", "purchase"]),
  litterId: z.string().optional(),
  litterVersion: z.number().int().positive().optional(),
  step: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  labId: z.string(),
  operationDate: dateOnlySchema,
  reason: z.string(),
  selectedAnimalIds: z.array(z.string()).max(300),
  femaleCount: z.number().int().min(0).max(100),
  maleCount: z.number().int().min(0).max(100),
  weanStrainId: z.string(),
  vendor: z.string(),
  orderReference: z.string(),
  disposition: z.enum(["holding", "quarantine"]),
  intakeNotes: z.string(),
  purchaseRows: z.array(purchaseRowSchema).max(300),
  subjects: z.array(z.object({
    id: z.string().min(1),
    label: z.string(),
    sex: z.enum(["male", "female", "unknown"]),
    strainId: z.string(),
    strainLabel: z.string(),
    purchaseRow: purchaseRowSchema.optional(),
  })).max(300),
  cages: z.array(cageDraftSchema).max(50),
  assignments: z.record(z.string(), z.string()),
  command: z.unknown(),
});

export function parseCageIntakeDraftPayload(value: unknown) {
  return cageIntakeDraftPayloadSchema.safeParse(value);
}
