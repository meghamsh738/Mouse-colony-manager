import { describe, expect, it } from "vitest";

import {
  canTransitionWelfareCase,
  canTransitionWelfareEscalation,
  canTransitionWelfareOrder,
  isAdministrableOrder,
  WELFARE_POLICY_MARKER,
} from "@/lib/welfare-state-machine";

describe("welfare state machine", () => {
  it("uses the visible synthetic fail-closed policy marker", () => {
    expect(WELFARE_POLICY_MARKER).toBe("synthetic-fail-closed-v1");
  });

  it("keeps case terminals closed and requires triage before treatment", () => {
    expect(canTransitionWelfareCase("open", "treatment_ordered")).toBe(false);
    expect(canTransitionWelfareCase("open", "triaged")).toBe(true);
    expect(canTransitionWelfareCase("triaged", "treatment_ordered")).toBe(true);
    expect(canTransitionWelfareCase("closed", "under_observation")).toBe(false);
    expect(canTransitionWelfareCase("cancelled", "open")).toBe(false);
  });

  it("allows cancellation only from the pristine open state", () => {
    expect(canTransitionWelfareCase("open", "cancelled")).toBe(true);
    for (const status of ["triaged", "under_observation", "treatment_ordered", "escalated"] as const) {
      expect(canTransitionWelfareCase(status, "cancelled")).toBe(false);
    }
  });

  it("requires explicit order approval before administration", () => {
    expect(isAdministrableOrder("proposed")).toBe(false);
    expect(isAdministrableOrder("approved")).toBe(true);
    expect(isAdministrableOrder("active")).toBe(true);
    expect(canTransitionWelfareOrder("proposed", "approved")).toBe(true);
    expect(canTransitionWelfareOrder("proposed", "active")).toBe(false);
    expect(canTransitionWelfareOrder("stopped", "active")).toBe(false);
  });

  it("requires acknowledgement before escalation resolution", () => {
    expect(canTransitionWelfareEscalation("open", "resolved")).toBe(false);
    expect(canTransitionWelfareEscalation("open", "acknowledged")).toBe(true);
    expect(canTransitionWelfareEscalation("acknowledged", "resolved")).toBe(true);
    expect(canTransitionWelfareEscalation("resolved", "open")).toBe(false);
  });
});
