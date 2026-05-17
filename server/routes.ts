import type { Express } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { insertFolderSchema, insertTileSchema } from "@shared/schema";
import { z } from "zod";
import { requireAuth, verifyToken } from "./auth";

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // ── Auth verify (before middleware so client can test its token) ──
  app.post("/api/auth/verify", verifyToken);

  // ── Protect all /api routes ────────────────────────────
  app.use("/api", requireAuth);

  // ── GET all data (folders + tiles) ─────────────────────
  app.get("/api/data", async (_req, res) => {
    try {
      const [folders, tiles] = await Promise.all([
        storage.getFolders(),
        storage.getTiles(),
      ]);
      res.json({ folders, tiles });
    } catch (err) {
      console.error("GET /api/data error:", err);
      res.status(500).json({ message: "Failed to load data" });
    }
  });

  // ── PUT replace all data (import / migration) ─────────
  // Caps the size of each text field as a defence against accidental
  // huge pastes; full body size is also capped at the express.json()
  // layer in server/index.ts.
  const MAX_TEXT_LEN = 1_000_000; // 1 MB per body field
  const MAX_TITLE_LEN = 1_000;
  const safeFolderInsert = insertFolderSchema.extend({
    name: z.string().max(MAX_TITLE_LEN),
    password: z.string().max(MAX_TITLE_LEN).nullable().optional(),
  });
  const safeTileInsert = insertTileSchema.extend({
    title: z.string().max(MAX_TITLE_LEN),
    body: z.string().max(MAX_TEXT_LEN).optional(),
  });
  const replaceAllSchema = z.object({
    folders: z.array(safeFolderInsert).max(10_000),
    tiles: z.array(safeTileInsert).max(10_000),
  });
  app.put("/api/data", async (req, res) => {
    try {
      const parsed = replaceAllSchema.parse(req.body);
      // Backfill sortOrder from array index when omitted, mirroring prior behaviour.
      const safeFolders = parsed.folders.map((f, i) => ({
        ...f,
        sortOrder: f.sortOrder ?? i,
      }));
      const safeTiles = parsed.tiles.map((t, i) => ({
        ...t,
        sortOrder: t.sortOrder ?? i,
      }));
      const trashGroupId = await storage.replaceAll({
        folders: safeFolders,
        tiles: safeTiles,
      });
      res.json({ ok: true, trashGroupId });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.message });
      }
      console.error("PUT /api/data error:", err);
      res.status(500).json({ message: "Failed to save data" });
    }
  });

  // ── Folders CRUD ───────────────────────────────────────

  app.put("/api/folders/:id", async (req, res) => {
    try {
      const folder = safeFolderInsert.parse({
        ...req.body,
        id: req.params.id,
      });
      const result = await storage.upsertFolder(folder);
      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.message });
      }
      console.error("PUT /api/folders error:", err);
      res.status(500).json({ message: "Failed to save folder" });
    }
  });

  app.delete("/api/folders/:id", async (req, res) => {
    try {
      const trashId = await storage.deleteFolder(req.params.id);
      res.json({ ok: true, trashId });
    } catch (err) {
      console.error("DELETE /api/folders error:", err);
      res.status(500).json({ message: "Failed to delete folder" });
    }
  });

  // ── Tiles CRUD ─────────────────────────────────────────

  app.put("/api/tiles/:id", async (req, res) => {
    try {
      const tile = safeTileInsert.parse({
        ...req.body,
        id: req.params.id,
      });
      const result = await storage.upsertTile(tile);
      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.message });
      }
      console.error("PUT /api/tiles error:", err);
      res.status(500).json({ message: "Failed to save tile" });
    }
  });

  app.delete("/api/tiles/:id", async (req, res) => {
    try {
      const trashId = await storage.deleteTile(req.params.id);
      res.json({ ok: true, trashId });
    } catch (err) {
      console.error("DELETE /api/tiles error:", err);
      res.status(500).json({ message: "Failed to delete tile" });
    }
  });

  // ── Trash bin ─────────────────────────────────────────

  app.get("/api/trash", async (_req, res) => {
    try {
      const items = await storage.getTrash();
      res.json(items);
    } catch (err) {
      console.error("GET /api/trash error:", err);
      res.status(500).json({ message: "Failed to load trash" });
    }
  });

  app.post("/api/trash/:id/restore", async (req, res) => {
    try {
      const result = await storage.restoreFromTrash(req.params.id);
      if (result.ok) {
        return res.json({ ok: true });
      }
      // Map known reasons to HTTP status codes so the client can
      // distinguish "user retried after recreating the same id"
      // (409) from "the trash entry vanished" (404) from "the
      // payload schema drifted" (422).
      switch (result.reason) {
        case "not_found":
          return res.status(404).json({ ok: false, reason: result.reason });
        case "id_exists":
          return res.status(409).json({ ok: false, reason: result.reason });
        default:
          return res.status(422).json({ ok: false, reason: result.reason });
      }
    } catch (err) {
      console.error("POST /api/trash/:id/restore error:", err);
      res.status(500).json({ message: "Failed to restore item" });
    }
  });

  app.delete("/api/trash/:id", async (req, res) => {
    try {
      await storage.permanentlyDelete(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      console.error("DELETE /api/trash/:id error:", err);
      res.status(500).json({ message: "Failed to permanently delete item" });
    }
  });

  return httpServer;
}
