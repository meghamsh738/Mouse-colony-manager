"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/auth";

export async function authenticateAction(_previousState: string | undefined, formData: FormData) {
  const email = formData.get("email");
  const password = formData.get("password");

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return "The email or password did not match a demo account.";
    }

    throw error;
  }
}
