import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__junhangPrisma ||
  new PrismaClient({
    log:
      process.env.PRISMA_QUERY_LOG === "1"
        ? ["query", "info", "warn", "error"]
        : ["warn"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__junhangPrisma = prisma;
}

export function createPrismaClient(options = {}) {
  return new PrismaClient(options);
}
