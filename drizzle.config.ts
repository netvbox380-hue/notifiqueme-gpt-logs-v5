import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",

  // ✅ IMPORTANTE para drizzle-kit v0.20
  driver: "pg",

  dbCredentials: {
    connectionString,
    ssl: { rejectUnauthorized: false },
  },
});