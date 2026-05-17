import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ── Tiles & Folders ──────────────────────────────────────────────

export const folders = pgTable("folders", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: text("name").notNull(),
  password: text("password"),
  icon: text("icon").notNull().default(""),
  color: text("color").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tiles = pgTable("tiles", {
  id: varchar("id", { length: 64 }).primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  folderId: varchar("folder_id", { length: 64 }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertFolderSchema = createInsertSchema(folders).omit({
  createdAt: true,
});
export const insertTileSchema = createInsertSchema(tiles).omit({
  createdAt: true,
});

export type Folder = typeof folders.$inferSelect;
export type InsertFolder = z.infer<typeof insertFolderSchema>;
export type Tile = typeof tiles.$inferSelect;
export type InsertTile = z.infer<typeof insertTileSchema>;

// ── Trash Bin ────────────────────────────────────────────────────
// Soft-delete store. Anything removed from `tiles` or `folders`
// lands here for 30 days, then is purged on the next server boot.
//
// `groupId` links rows trashed together (e.g. a folder and its tiles
// are deleted in one user action — they share a groupId so restoring
// the folder also restores its tiles).

export const trashedItems = pgTable("trashed_items", {
  id: varchar("id", { length: 64 }).primaryKey(),
  kind: text("kind").notNull(), // "tile" | "folder"
  originalId: varchar("original_id", { length: 64 }).notNull(),
  groupId: varchar("group_id", { length: 64 }),
  payload: jsonb("payload").notNull(),
  deletedAt: timestamp("deleted_at").defaultNow().notNull(),
});

export type TrashedItem = typeof trashedItems.$inferSelect;

// Runtime-validated payload shapes for trash entries. Used during
// `restoreFromTrash` so we never blindly cast jsonb into a row type
// that may have evolved since the trash entry was written.
export const trashedTilePayloadSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string().nullable().optional(),
  folderId: z.string().nullable().optional(),
  sortOrder: z.number().int().nullable().optional(),
});

export const trashedFolderPayloadSchema = z.object({
  id: z.string(),
  name: z.string(),
  password: z.string().nullable().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  sortOrder: z.number().int().nullable().optional(),
});
