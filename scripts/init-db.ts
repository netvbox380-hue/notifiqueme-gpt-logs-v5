import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { hashPassword } from "../server/_core/password";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`[init-db] Missing env: ${name}`);
  return v;
}

async function main() {
  const databaseUrl = mustEnv("DATABASE_URL");

  const sqlPath = path.join(__dirname, "create-tables.sql");
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`[init-db] SQL file not found: ${sqlPath}`);
  }

  const sql = fs.readFileSync(sqlPath, "utf-8");

  const client = new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : undefined,
  });

  console.log("[init-db] Connecting...");
  await client.connect();

  try {
    console.log("[init-db] Running create-tables.sql...");
    await client.query(sql);

    const ownerOpenId = process.env.OWNER_OPEN_ID;
    const ownerPassword = process.env.OWNER_PASSWORD;

    if (ownerOpenId) {
      const exists = await client.query(
        `SELECT id FROM "users" WHERE "openId" = $1 LIMIT 1`,
        [ownerOpenId]
      );

      if (exists.rowCount === 0) {
        const passwordHash = ownerPassword ? hashPassword(ownerPassword) : null;

        await client.query(
          `INSERT INTO "users" ("openId", "role", "passwordHash", "createdAt", "updatedAt", "lastSignedIn")
           VALUES ($1, 'owner', $2, NOW(), NOW(), NOW())`,
          [ownerOpenId, passwordHash]
        );

        console.log(`[init-db] Owner created: ${ownerOpenId}`);
      } else {
        console.log(`[init-db] Owner already exists: ${ownerOpenId}`);
      }
    } else {
      console.log("[init-db] OWNER_OPEN_ID not set; skipping owner creation.");
    }

    console.log("[init-db] Done ✅");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
