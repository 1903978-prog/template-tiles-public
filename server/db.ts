import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import * as schema from "@shared/schema";

// Don't throw at module level — let errors be caught by the startup try-catch.
// pg.Pool doesn't connect until the first query, so this is safe even if
// DATABASE_URL is missing (it will fail later inside ensureTables).
if (!process.env.DATABASE_URL) {
  console.error("[db] WARNING: DATABASE_URL is not set!");
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });

/**
 * Create tables if they don't exist. Runs once at server startup.
 * This replaces `drizzle-kit push` so we don't need it in the build/start pipeline.
 */
export async function ensureTables(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }

  console.log("[db] Connecting to database...");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS folders (
      id VARCHAR(64) PRIMARY KEY,
      name TEXT NOT NULL,
      password TEXT,
      icon TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    -- Backfill columns for DBs created before icon/color existed.
    ALTER TABLE folders ADD COLUMN IF NOT EXISTS icon TEXT NOT NULL DEFAULT '';
    ALTER TABLE folders ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '';

    CREATE TABLE IF NOT EXISTS tiles (
      id VARCHAR(64) PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      folder_id VARCHAR(64),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS trashed_items (
      id VARCHAR(64) PRIMARY KEY,
      kind TEXT NOT NULL,
      original_id VARCHAR(64) NOT NULL,
      group_id VARCHAR(64),
      payload JSONB NOT NULL,
      deleted_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    -- Backfill column for DBs created before group_id existed.
    ALTER TABLE trashed_items ADD COLUMN IF NOT EXISTS group_id VARCHAR(64);
    CREATE INDEX IF NOT EXISTS trashed_items_deleted_at_idx
      ON trashed_items(deleted_at);
    CREATE INDEX IF NOT EXISTS trashed_items_group_id_idx
      ON trashed_items(group_id);
  `);
  console.log("[db] Tables verified/created.");
}

/**
 * Initialize default vault sections if they don't exist.
 * Creates: Websites, Locations, Passwords with icons and colors.
 */
export async function initializeDefaultFolders(): Promise<void> {
  const defaultFolders = [
    {
      id: "default-websites",
      name: "Websites",
      icon: "🌐",
      color: "#3b82f6", // blue
      sortOrder: 0,
    },
    {
      id: "default-locations",
      name: "Locations",
      icon: "📍",
      color: "#10b981", // green
      sortOrder: 1,
    },
    {
      id: "default-passwords",
      name: "Passwords",
      icon: "🔐",
      color: "#ef4444", // red
      sortOrder: 2,
    },
  ];

  try {
    for (const folder of defaultFolders) {
      const existing = await db.select().from(schema.folders)
        .where(eq(schema.folders.id, folder.id)).limit(1);

      if (!existing.length) {
        await db.insert(schema.folders).values(folder);
        console.log(`[db] Created default folder: ${folder.name}`);
      }
    }
  } catch (error) {
    console.error("[db] Error initializing default folders:", error);
  }
}
