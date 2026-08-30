import type {
  WelfareCaseStatus,
  WelfareEscalationStatus,
  WelfareTreatmentOrderStatus,
} from "@prisma/client";

export const WELFARE_POLICY_MARKER = "synthetic-fail-closed-v1" as const;
export const WELFARE_CANCELLATION_CODES = ["duplicate", "not_a_case"] as const;

const caseTransitions: Record<WelfareCaseStatus, readonly WelfareCaseStatus[]> = {
  open: ["triaged", "under_observation", "escalated", "cancelled"],
  triaged: ["under_observation", "treatment_ordered", "escalated"],
  under_observation: ["under_observation", "treatment_ordered", "escalated", "closed"],
  treatment_ordered: ["treatment_ordered", "under_observation", "escalated", "closed"],
  escalated: ["escalated", "under_observation", "treatment_ordered", "closed"],
  closed: [],
  cancelled: [],
};

const orderTransitions: Record<WelfareTreatmentOrderStatus, readonly WelfareTreatmentOrderStatus[]> = {
  proposed: ["approved", "cancelled"],
  approved: ["active", "stopped", "completed"],
  active: ["active", "stopped", "completed"],
  stopped: [],
  completed: [],
  cancelled: [],
};

const escalationTransitions: Record<WelfareEscalationStatus, readonly WelfareEscalationStatus[]> = {
  open: ["acknowledged"],
  acknowledged: ["resolved"],
  resolved: [],
};

export function canTransitionWelfareCase(from: WelfareCaseStatus, to: WelfareCaseStatus) {
  return caseTransitions[from].includes(to);
}

export function canTransitionWelfareOrder(from: WelfareTreatmentOrderStatus, to: WelfareTreatmentOrderStatus) {
  return orderTransitions[from].includes(to);
}

export function canTransitionWelfareEscalation(from: WelfareEscalationStatus, to: WelfareEscalationStatus) {
  return escalationTransitions[from].includes(to);
}

export function isTerminalWelfareCase(status: WelfareCaseStatus) {
  return status === "closed" || status === "cancelled";
}

export function isAdministrableOrder(status: WelfareTreatmentOrderStatus) {
  return status === "approved" || status === "active";
}
