import { eq, asc, lt } from "drizzle-orm";
import { db } from "./db";
import {
  folders,
  tiles,
  trashedItems,
  trashedTilePayloadSchema,
  trashedFolderPayloadSchema,
  type Folder,
  type InsertFolder,
  type Tile,
  type InsertTile,
  type TrashedItem,
} from "@shared/schema";

const TRASH_RETENTION_DAYS = 30;

function newTrashId(): string {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10)
  );
}

/**
 * Strip secrets from a folder row before snapshotting it into trash.
 * The plaintext password must not be retained in `trashed_items.payload`.
 */
function sanitizeFolderForTrash(f: Folder): Omit<Folder, "password"> & {
  password: null;
} {
  // Spread the full row so new columns (icon, color, …) are preserved
  // on restore, then hard-null the secret. This stays correct as the
  // folders schema evolves.
  return {
    ...f,
    password: null,
  };
}

export interface IStorage {
  // Folders
  getFolders(): Promise<Folder[]>;
  upsertFolder(folder: InsertFolder): Promise<Folder>;
  /** Returns the new trash entry id for the folder, or null if no row was deleted. */
  deleteFolder(id: string): Promise<string | null>;

  // Tiles
  getTiles(): Promise<Tile[]>;
  upsertTile(tile: InsertTile): Promise<Tile>;
  /** Returns the new trash entry id for the tile, or null if no row was deleted. */
  deleteTile(id: string): Promise<string | null>;

  // Bulk (for import / migration)
  /** Returns the groupId of the snapshotted prior state, or null if the DB was empty. */
  replaceAll(data: {
    folders: InsertFolder[];
    tiles: InsertTile[];
  }): Promise<string | null>;

  // Trash bin
  getTrash(): Promise<TrashedItem[]>;
  restoreFromTrash(trashId: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  permanentlyDelete(trashId: string): Promise<void>;
  purgeExpiredTrash(): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  // ── Folders ──────────────────────────────────────────

  async getFolders(): Promise<Folder[]> {
    return db.select().from(folders).orderBy(asc(folders.sortOrder));
  }

  async upsertFolder(folder: InsertFolder): Promise<Folder> {
    const [result] = await db
      .insert(folders)
      .values(folder)
      .onConflictDoUpdate({
        target: folders.id,
        set: {
          name: folder.name,
          password: folder.password ?? null,
          icon: folder.icon ?? "",
          color: folder.color ?? "",
          sortOrder: folder.sortOrder ?? 0,
        },
      })
      .returning();
    return result;
  }

  /**
   * Soft-delete a folder. Snapshots the folder AND all tiles inside it
   * into `trashed_items` under a shared groupId, so a single Restore call
   * brings the folder back together with its templates. Tiles in the live
   * `tiles` table are removed (not orphaned to null) — restore is now the
   * single recovery path.
   *
   * Folder password is stripped from the snapshot to avoid retaining a
   * plaintext secret inside `trashed_items.payload`.
   */
  async deleteFolder(id: string): Promise<string | null> {
    return db.transaction(async (tx) => {
      const [target] = await tx
        .select()
        .from(folders)
        .where(eq(folders.id, id));
      if (!target) return null;

      const childTiles = await tx
        .select()
        .from(tiles)
        .where(eq(tiles.folderId, id));

      const groupId = newTrashId();
      const folderTrashId = newTrashId();
      const deletedAt = new Date();

      // Trash the folder (password redacted).
      await tx.insert(trashedItems).values({
        id: folderTrashId,
        kind: "folder",
        originalId: target.id,
        groupId,
        payload: sanitizeFolderForTrash(target),
        deletedAt,
      });

      // Trash each child tile under the same group, then remove them.
      if (childTiles.length > 0) {
        await tx.insert(trashedItems).values(
          childTiles.map((t) => ({
            id: newTrashId(),
            kind: "tile",
            originalId: t.id,
            groupId,
            payload: t,
            deletedAt,
          })),
        );
        await tx.delete(tiles).where(eq(tiles.folderId, id));
      }

      await tx.delete(folders).where(eq(folders.id, id));
      return folderTrashId;
    });
  }

  // ── Tiles ────────────────────────────────────────────

  async getTiles(): Promise<Tile[]> {
    return db.select().from(tiles).orderBy(asc(tiles.sortOrder));
  }

  async upsertTile(tile: InsertTile): Promise<Tile> {
    const [result] = await db
      .insert(tiles)
      .values(tile)
      .onConflictDoUpdate({
        target: tiles.id,
        set: {
          title: tile.title,
          body: tile.body ?? "",
          folderId: tile.folderId ?? null,
          sortOrder: tile.sortOrder ?? 0,
        },
      })
      .returning();
    return result;
  }

  async deleteTile(id: string): Promise<string | null> {
    return db.transaction(async (tx) => {
      const [target] = await tx
        .select()
        .from(tiles)
        .where(eq(tiles.id, id));
      if (!target) return null;

      const trashId = newTrashId();
      await tx.delete(tiles).where(eq(tiles.id, id));
      await tx.insert(trashedItems).values({
        id: trashId,
        kind: "tile",
        originalId: target.id,
        groupId: null,
        payload: target,
        deletedAt: new Date(),
      });
      return trashId;
    });
  }

  // ── Bulk ─────────────────────────────────────────────

  /**
   * Replace the entire dataset (used by Import). The previous contents
   * are snapshotted into `trashed_items` under a single groupId so the
   * user can restore from trash if the import was a mistake. This makes
   * the most-destructive operation in the app recoverable, matching the
   * rest of the trash bin's promise.
   */
  async replaceAll(data: {
    folders: InsertFolder[];
    tiles: InsertTile[];
  }): Promise<string | null> {
    return db.transaction(async (tx) => {
      const existingFolders = await tx.select().from(folders);
      const existingTiles = await tx.select().from(tiles);

      let groupId: string | null = null;

      if (existingFolders.length > 0 || existingTiles.length > 0) {
        groupId = newTrashId();
        const deletedAt = new Date();
        const rows: (typeof trashedItems.$inferInsert)[] = [];
        for (const f of existingFolders) {
          rows.push({
            id: newTrashId(),
            kind: "folder",
            originalId: f.id,
            groupId,
            payload: sanitizeFolderForTrash(f),
            deletedAt,
          });
        }
        for (const t of existingTiles) {
          rows.push({
            id: newTrashId(),
            kind: "tile",
            originalId: t.id,
            groupId,
            payload: t,
            deletedAt,
          });
        }
        if (rows.length > 0) await tx.insert(trashedItems).values(rows);
      }

      await tx.delete(tiles);
      await tx.delete(folders);
      if (data.folders.length > 0) {
        await tx.insert(folders).values(data.folders);
      }
      if (data.tiles.length > 0) {
        await tx.insert(tiles).values(data.tiles);
      }

      return groupId;
    });
  }

  // ── Trash bin ─────────────────────────────────────────

  async getTrash(): Promise<TrashedItem[]> {
    return db
      .select()
      .from(trashedItems)
      .orderBy(asc(trashedItems.deletedAt));
  }

  /**
   * Restore an item (and its group, if any) back into the live tables.
   *
   * - If the trash entry has a groupId, every entry in that group is
   *   restored together. Restoring a folder therefore also restores
   *   the tiles that were trashed alongside it.
   * - Refuses to overwrite a live row with the same id (returns
   *   `{ ok: false, reason: "id_exists" }`) — the previous version
   *   silently overwrote, which could clobber unrelated user data.
   * - When a tile's `folderId` points at a folder that no longer
   *   exists in the live table after this restore, it is reset to
   *   null so the tile reappears as Uncategorized rather than
   *   pointing at a phantom folder.
   * - Uses runtime-validated payload schemas instead of `as Tile`
   *   casts, so old trash entries written before a schema change
   *   surface a clear error rather than silently failing later.
   */
  async restoreFromTrash(
    trashId: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    return db.transaction(async (tx) => {
      const [entry] = await tx
        .select()
        .from(trashedItems)
        .where(eq(trashedItems.id, trashId));
      if (!entry) return { ok: false, reason: "not_found" } as const;

      const groupRows = entry.groupId
        ? await tx
            .select()
            .from(trashedItems)
            .where(eq(trashedItems.groupId, entry.groupId))
        : [entry];

      // Stage 1: collision check — refuse if any target id already
      // exists in the live tables. Better a 409 than a silent overwrite.
      for (const row of groupRows) {
        if (row.kind === "folder") {
          const [hit] = await tx
            .select({ id: folders.id })
            .from(folders)
            .where(eq(folders.id, row.originalId));
          if (hit) return { ok: false, reason: "id_exists" } as const;
        } else if (row.kind === "tile") {
          const [hit] = await tx
            .select({ id: tiles.id })
            .from(tiles)
            .where(eq(tiles.id, row.originalId));
          if (hit) return { ok: false, reason: "id_exists" } as const;
        }
      }

      // Stage 2: parse + insert.
      const restoredFolderIds = new Set<string>();
      for (const row of groupRows) {
        if (row.kind === "folder") {
          const parsed = trashedFolderPayloadSchema.safeParse(row.payload);
          if (!parsed.success) {
            return {
              ok: false,
              reason: `invalid_folder_payload: ${parsed.error.message}`,
            } as const;
          }
          await tx.insert(folders).values({
            id: parsed.data.id,
            name: parsed.data.name,
            password: parsed.data.password ?? null,
            icon: parsed.data.icon ?? "",
            color: parsed.data.color ?? "",
            sortOrder: parsed.data.sortOrder ?? 0,
          });
          restoredFolderIds.add(parsed.data.id);
        }
      }
      for (const row of groupRows) {
        if (row.kind === "tile") {
          const parsed = trashedTilePayloadSchema.safeParse(row.payload);
          if (!parsed.success) {
            return {
              ok: false,
              reason: `invalid_tile_payload: ${parsed.error.message}`,
            } as const;
          }
          // If the tile's original folder isn't being restored in this
          // group AND doesn't exist in the live table, drop folderId so
          // the tile reappears as Uncategorized.
          let folderId: string | null = parsed.data.folderId ?? null;
          if (folderId && !restoredFolderIds.has(folderId)) {
            const [hit] = await tx
              .select({ id: folders.id })
              .from(folders)
              .where(eq(folders.id, folderId));
            if (!hit) folderId = null;
          }
          await tx.insert(tiles).values({
            id: parsed.data.id,
            title: parsed.data.title,
            body: parsed.data.body ?? "",
            folderId,
            sortOrder: parsed.data.sortOrder ?? 0,
          });
        }
      }

      // Stage 3: drop the restored entries from trash.
      const idsToDelete = groupRows.map((r) => r.id);
      for (const id of idsToDelete) {
        await tx.delete(trashedItems).where(eq(trashedItems.id, id));
      }

      return { ok: true } as const;
    });
  }

  async permanentlyDelete(trashId: string): Promise<void> {
    // Permanent-delete drops the entry AND its sibling group rows so
    // a folder + its tiles vanish together, mirroring how they entered
    // trash.
    await db.transaction(async (tx) => {
      const [entry] = await tx
        .select()
        .from(trashedItems)
        .where(eq(trashedItems.id, trashId));
      if (!entry) return;

      if (entry.groupId) {
        await tx
          .delete(trashedItems)
          .where(eq(trashedItems.groupId, entry.groupId));
      } else {
        await tx.delete(trashedItems).where(eq(trashedItems.id, trashId));
      }
    });
  }

  async purgeExpiredTrash(): Promise<number> {
    const cutoff = new Date(
      Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const result = await db
      .delete(trashedItems)
      .where(lt(trashedItems.deletedAt, cutoff))
      .returning({ id: trashedItems.id });
    return result.length;
  }
}

export const storage = new DatabaseStorage();

export { TRASH_RETENTION_DAYS };
