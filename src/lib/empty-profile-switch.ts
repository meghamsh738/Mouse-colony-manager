import { EMPTY_PROFILES, isEmptyProfileId } from "@/lib/empty-profile-config";

type EmptyProfileSwitchVerification = {
  sourceProfileId: unknown;
  sourceActive: boolean;
  destinationProfileId: unknown;
  destinationActive: boolean;
  destinationEmail?: string | null;
  configuredInstanceId?: string;
  storedInstanceId?: unknown;
};

export function isEmptyProfileSwitcherEnabled(nodeEnv?: string, featureFlag?: string) {
  return nodeEnv !== "production" && featureFlag === "true";
}

export function isVerifiedEmptyProfileSwitch({
  sourceProfileId,
  sourceActive,
  destinationProfileId,
  destinationActive,
  destinationEmail,
  configuredInstanceId,
  storedInstanceId,
}: EmptyProfileSwitchVerification) {
  if (
    !isEmptyProfileId(sourceProfileId) ||
    !sourceActive ||
    !isEmptyProfileId(destinationProfileId) ||
    !destinationActive ||
    !configuredInstanceId ||
    configuredInstanceId.length < 24 ||
    storedInstanceId !== configuredInstanceId
  ) {
    return false;
  }

  const destination = EMPTY_PROFILES.find((profile) => profile.id === destinationProfileId);

  return destination?.email === destinationEmail;
}
