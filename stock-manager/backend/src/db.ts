import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";

// Prisma 7 connects through a driver adapter instead of an embedded engine URL.
const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});

export const prisma = new PrismaClient({ adapter });
