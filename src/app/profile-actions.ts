"use server";

import { auth, signIn } from "@/auth";
import { EMPTY_PROFILES, isEmptyProfileId } from "@/lib/empty-profile-config";
import { isEmptyProfileSwitcherEnabled, isVerifiedEmptyProfileSwitch } from "@/lib/empty-profile-switch";
import { prisma } from "@/lib/prisma";

export async function switchEmptyProfileAction(formData: FormData) {
  if (!isEmptyProfileSwitcherEnabled(process.env.NODE_ENV, process.env.EMPTY_PROFILE_SWITCHER)) {
    throw new Error("Profile switching is disabled.");
  }

  const instanceId = process.env.EMPTY_PROFILE_INSTANCE_ID;
  const profilePassword = process.env.EMPTY_ADMIN_PASSWORD;

  if (!instanceId || !profilePassword) {
    throw new Error("Profile switching is not configured.");
  }

  const session = await auth();

  if (!session?.user?.id || !isEmptyProfileId(session.user.id)) {
    throw new Error("Unauthorized profile switch.");
  }

  const profileId = formData.get("profileId");

  if (!isEmptyProfileId(profileId)) {
    throw new Error("Unknown profile.");
  }

  const destination = EMPTY_PROFILES.find((profile) => profile.id === profileId);
  const [sourceUser, destinationUser, instanceMarker] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { active: true },
    }),
    prisma.user.findUnique({
      where: { id: profileId },
      select: { active: true, email: true },
    }),
    prisma.ruleConfig.findUnique({
      where: { key: "empty_profile_switcher_instance" },
      select: { value: true },
    }),
  ]);

  if (!destination || !isVerifiedEmptyProfileSwitch({
    sourceProfileId: session.user.id,
    sourceActive: sourceUser?.active ?? false,
    destinationProfileId: profileId,
    destinationActive: destinationUser?.active ?? false,
    destinationEmail: destinationUser?.email,
    configuredInstanceId: instanceId,
    storedInstanceId: instanceMarker?.value,
  })) {
    throw new Error("Profile switching is unavailable for this instance.");
  }

  await signIn("credentials", {
    email: destination.email,
    password: profilePassword,
    redirectTo: "/",
  });
}
