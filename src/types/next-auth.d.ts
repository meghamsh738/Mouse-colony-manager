import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "admin" | "colony_manager" | "animal_staff" | "researcher" | "read_only";
    } & DefaultSession["user"];
  }

  interface User {
    role: "admin" | "colony_manager" | "animal_staff" | "researcher" | "read_only";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "admin" | "colony_manager" | "animal_staff" | "researcher" | "read_only";
  }
}
