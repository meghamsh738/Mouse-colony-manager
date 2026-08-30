import { describe, expect, it } from "vitest";

import { CORRECTION_POLICY_MARKER, canTransitionCorrection } from "@/lib/correction-state-machine";
import { evaluateCorrectionProposal } from "@/lib/correction-target";

describe("M15 correction state machine", () => {
  it("keeps blocked requests distinct from applied corrections", () => {
    expect(CORRECTION_POLICY_MARKER).toBe("synthetic-controlled-metadata-supersession-v1");
    expect(canTransitionCorrection("blocked", "applied")).toBe(false);
    expect(canTransitionCorrection("blocked", "rejected")).toBe(true);
    expect(canTransitionCorrection("pending", "applied")).toBe(true);
  });

  it("permits metadata-only movement supersession while blocking a physical cage change", () => {
    const original = { id: "move-1", movedAt: "2026-01-01T10:00:00.000Z", reason: "original", fromCageId: "cage-a", toCageId: "cage-b" };
    expect(evaluateCorrectionProposal("animal_move", original, { movedAt: "2026-01-01T10:05:00.000Z", reason: "corrected" }, []).safe).toBe(true);
    expect(evaluateCorrectionProposal("animal_move", original, { toCageId: "cage-c" }, []).blockCode).toBe("physical_move_change_not_supported");
  });

  it("fails closed for generated weaning, lifecycle status, transfer custody, procedure status, and biosample custody", () => {
    expect(evaluateCorrectionProposal("litter_weaning", { litterSizeWean: 4 }, { litterSizeWean: 5 }, []).blockCode).toBe("generated_weaning_state_requires_policy");
    expect(evaluateCorrectionProposal("animal_lifecycle", { toStatus: "archived", happenedAt: "2026-01-01T00:00:00.000Z" }, { toStatus: "active" }, []).blockCode).toBe("terminal_lifecycle_change_not_supported");
    expect(evaluateCorrectionProposal("cross_lab_transfer", { sourceLabId: "a", destinationLabId: "b" }, { destinationLabId: "c" }, []).blockCode).toBe("custody_transfer_change_not_supported");
    expect(evaluateCorrectionProposal("procedure_occurrence", { status: "completed", occurredAt: "2026-01-01T00:00:00.000Z" }, { status: "aborted" }, []).blockCode).toBe("procedure_status_change_not_supported");
    expect(evaluateCorrectionProposal("biosample", { status: "stored", animalId: "a", storageLocation: "f", quantityLabel: "1" }, { storageLocation: "g" }, []).blockCode).toBe("biosample_custody_change_not_supported");
  });

  it("blocks a birth correction after dependent pups or weaning evidence exists", () => {
    const result = evaluateCorrectionProposal("litter_birth", { birthDate: "2026-01-01T00:00:00.000Z", litterSizeBirth: 4, litterSizeWean: 3 }, { litterSizeBirth: 5 }, [{ entityType: "Animal", entityId: "a" }]);
    expect(result.safe).toBe(false);
    expect(result.blockCode).toBe("birth_count_change_requires_policy");
  });

  it("blocks a structural birth-count correction even before dependent records exist", () => {
    const result = evaluateCorrectionProposal("litter_birth", { birthDate: "2026-01-01T00:00:00.000Z", litterSizeBirth: 4, litterSizeWean: null }, { litterSizeBirth: 5 }, []);
    expect(result.safe).toBe(false);
    expect(result.blockCode).toBe("birth_count_change_requires_policy");
  });

  it("allows a notes-only birth metadata supersession without changing birth structure", () => {
    const result = evaluateCorrectionProposal("litter_birth", { birthDate: "2026-01-01T00:00:00.000Z", litterSizeBirth: 4, litterSizeWean: 3, notes: null }, { notes: "Corrected metadata note" }, [{ entityType: "Animal", entityId: "a" }]);
    expect(result.safe).toBe(true);
    expect(result.blockCode).toBeNull();
  });
});
