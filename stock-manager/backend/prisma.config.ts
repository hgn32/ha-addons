import path from "node:path";
import { defineConfig, env } from "prisma/config";

// Prisma 7 moves the connection URL out of schema.prisma into this config file.
// Used by CLI commands such as `prisma db push` / `prisma migrate`.
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    url: env("DATABASE_URL"),
  },
});
