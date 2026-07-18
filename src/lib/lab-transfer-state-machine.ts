import type {
  LabMembershipRole,
  LabTransferRequestStatus,
  LabTransferSubjectType,
  Sex,
} from "@prisma/client";

import { canonicalJsonHash } from "@/lib/command-foundation";
import type { ResolvedActor } from "@/lib/session";

const TRANSFER_PRINCIPAL_ROLES = new Set<LabMembershipRole>(["owner", "manager"]);

export type TransferPacketAnimal = {
  id: string;
  facilityAnimalId: string;
  animalId: string;
  sex: Sex;
  dob: string;
  strain: string;
  healthStatus: string | null;
  sourceCageBarcode: string | null;
};

export type DestinationTransferPacket = {
  requestId: string;
  subjectType: LabTransferSubjectType;
  sourceLab: { id: string; code: string; name: string };
  destinationLab: { id: string; code: string; name: string };
  reason: string;
  requestedEffectiveAt: string;
  sourceCage: {
    id: string;
    barcode: string;
    location: string;
    status: string;
  } | null;
  destinationCage: {
    id: string;
    barcode: string;
    location: string;
    status: string;
    occupancy: number;
    capacity: number;
    occupantSexCounts: { male: number; female: number; unknown: number };
    occupancyFingerprint: string;
    mixedSexHoldingAllowed: boolean;
  } | null;
  animals: TransferPacketAnimal[];
};

export function canRequestLabTransfer(actor: ResolvedActor, sourceLabId: string) {
  return actor.canonicalRole === "lab_user"
    && actor.activeMembership?.labId === sourceLabId
    && TRANSFER_PRINCIPAL_ROLES.has(actor.activeMembership.role)
    && actor.capabilities.includes("transfers:request");
}

export function canDecideLabTransfer(actor: ResolvedActor, destinationLabId: string) {
  return actor.canonicalRole === "lab_user"
    && actor.activeMembership?.labId === destinationLabId
    && TRANSFER_PRINCIPAL_ROLES.has(actor.activeMembership.role)
    && actor.capabilities.includes("transfers:approve");
}

export function canFinalizeLabTransfer(actor: ResolvedActor) {
  return (actor.canonicalRole === "cmu_staff" || actor.canonicalRole === "facility_admin")
    && actor.capabilities.includes("transfers:finalize");
}

export function canOverrideLabTransferBlocks(actor: ResolvedActor) {
  return actor.canonicalRole === "facility_admin";
}

export function isTransferAcceptanceCurrent(input: {
  status: LabTransferRequestStatus;
  packetVersion: number;
  packetHash: string;
  acceptedPacketVersion: number | null;
  acceptedPacketHash: string | null;
}) {
  return input.status === "destination_accepted"
    && input.acceptedPacketVersion === input.packetVersion
    && input.acceptedPacketHash === input.packetHash;
}

export function canReviseLabTransfer(status: LabTransferRequestStatus) {
  return status === "requested"
    || status === "destination_accepted"
    || status === "destination_rejected";
}

export function canCancelLabTransfer(status: LabTransferRequestStatus) {
  return status === "requested"
    || status === "destination_accepted"
    || status === "destination_rejected";
}

export function buildDestinationTransferPacket(input: DestinationTransferPacket) {
  const packet: DestinationTransferPacket = {
    ...input,
    animals: [...input.animals].sort((left, right) => (
      left.facilityAnimalId.localeCompare(right.facilityAnimalId)
      || left.id.localeCompare(right.id)
    )),
  };

  return {
    packet,
    payloadHash: canonicalJsonHash(packet),
  };
}
