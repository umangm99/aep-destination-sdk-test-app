import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL environment variable is not set. " +
      "Get a free Neon Postgres database at https://neon.tech"
    );
  }

  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}

// Lazy singleton — connection created on first use
let _db: ReturnType<typeof getDb> | null = null;

export function db() {
  if (!_db) {
    _db = getDb();
  }
  return _db;
}
