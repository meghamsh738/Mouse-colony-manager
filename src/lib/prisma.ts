import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  __mouseColonyPrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.__mouseColonyPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__mouseColonyPrisma = prisma;
}
