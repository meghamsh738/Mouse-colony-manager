import { z } from "zod";

export const moveCageSchema = z.object({
  cageId: z.string().trim().min(1),
  roomId: z.string().trim().min(1),
  rackId: z.string().trim().min(1),
  cageNumber: z.string().trim().min(1).max(12),
  movedAt: z.string().trim().min(1),
  reason: z.string().trim().min(3).max(300),
});

export type MoveCageFormValues = z.infer<typeof moveCageSchema>;
