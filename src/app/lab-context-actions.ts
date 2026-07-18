"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { ACTIVE_LAB_COOKIE, requireUser } from "@/lib/session";

export async function setActiveLabAction(formData: FormData) {
  const actor = await requireUser({ capability: "dashboard:view" });
  const labId = formData.get("labId");

  if (actor.canonicalRole !== "lab_user" || typeof labId !== "string") {
    throw new Error("Lab switching is unavailable.");
  }

  if (!actor.memberships.some((membership) => membership.labId === labId)) {
    throw new Error("You do not have access to that lab.");
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_LAB_COOKIE, labId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  revalidatePath("/", "layout");
}
