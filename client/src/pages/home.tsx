import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { ToastAction } from "@/components/ui/toast";
import {
  Plus,
  Search,
  Copy,
  Pencil,
  Trash2,
  Upload,
  Check,
  LayoutGrid,
  ClipboardPaste,
  FolderOpen,
  FolderPlus,
  Inbox,
  GripVertical,
  X,
  FileText,
  Lock,
  Unlock,
  Settings,
  Code,
  Database,
  Star,
  Clock,
  Boxes,
} from "lucide-react";

interface Folder {
  id: string;
  name: string;
  password?: string | null;
  icon?: string;
  color?: string;
  sortOrder?: number;
}

interface TemplateTile {
  id: string;
  title: string;
  body: string;
  folderId: string | null;
  sortOrder?: number;
}

interface AppData {
  folders: Folder[];
  tiles: TemplateTile[];
}

const STORAGE_KEY = "template-tiles-data";
const VERSION_KEY = "template-tiles-version";
const APP_VERSION = "6";
const FAVORITES_KEY = "template-tiles-favorites";
const RECENT_KEY = "template-tiles-recent";
const UNCATEGORIZED_ID = "__uncategorized__";
const SITE_AUTH_KEY = "template-tiles-auth-token";
const MIGRATED_KEY = "template-tiles-migrated-to-db";

// ── API helpers ─────────────────────────────────────────
async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const token = localStorage.getItem(SITE_AUTH_KEY);
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...opts,
  });
  if (res.status === 401) {
    const hadToken = !!localStorage.getItem(SITE_AUTH_KEY);
    localStorage.removeItem(SITE_AUTH_KEY);
    if (hadToken) window.location.reload(); // only reload for expired tokens
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiVerifyToken(password: string): Promise<boolean> {
  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${password}`,
    },
  });
  return res.ok;
}

async function apiLoadData(): Promise<AppData> {
  return apiFetch<AppData>("/api/data");
}

async function apiSaveAll(data: AppData): Promise<void> {
  await apiFetch("/api/data", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

async function apiUpsertTile(tile: TemplateTile): Promise<void> {
  await apiFetch(`/api/tiles/${tile.id}`, {
    method: "PUT",
    body: JSON.stringify(tile),
  });
}

interface DeleteResponse {
  ok: boolean;
  trashId: string | null;
}

async function apiDeleteTile(id: string): Promise<string | null> {
  const res = await apiFetch<DeleteResponse>(`/api/tiles/${id}`, { method: "DELETE" });
  return res.trashId;
}

async function apiUpsertFolder(folder: Folder): Promise<void> {
  await apiFetch(`/api/folders/${folder.id}`, {
    method: "PUT",
    body: JSON.stringify(folder),
  });
}

async function apiDeleteFolder(id: string): Promise<string | null> {
  const res = await apiFetch<DeleteResponse>(`/api/folders/${id}`, { method: "DELETE" });
  return res.trashId;
}

async function apiRestoreFromTrash(
  trashId: string,
): Promise<{ ok: true } | { ok: false; reason: string; status: number }> {
  const token = localStorage.getItem(SITE_AUTH_KEY);
  const res = await fetch(`/api/trash/${encodeURIComponent(trashId)}/restore`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.ok) return { ok: true };
  let reason = "unknown";
  try {
    const body = await res.json();
    if (typeof body?.reason === "string") reason = body.reason;
  } catch {
    /* ignore parse errors */
  }
  return { ok: false, reason, status: res.status };
}

async function apiPermanentlyDeleteTrash(trashId: string): Promise<void> {
  const token = localStorage.getItem(SITE_AUTH_KEY);
  const res = await fetch(`/api/trash/${encodeURIComponent(trashId)}`, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
}

// Default content is now seeded server-side only (server/seed.ts).
// Client starts empty and loads from the database.
const EMPTY_DATA: AppData = { folders: [], tiles: [] };

function loadLocalData(): AppData | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.folders && parsed.tiles) {
        return {
          folders: parsed.folders,
          tiles: parsed.tiles.map((t: any) => ({
            ...t,
            folderId: t.folderId ?? null,
          })),
        };
      }
    }
  } catch (e) {
    console.warn("Failed to load localStorage data:", e);
  }
  return null;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export default function Home() {
  const queryClient = useQueryClient();
  const [siteAuthenticated, setSiteAuthenticated] = useState(() => {
    return !!localStorage.getItem(SITE_AUTH_KEY);
  });
  const [sitePasswordInput, setSitePasswordInput] = useState("");
  const [sitePasswordError, setSitePasswordError] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

  const handleSiteLogin = async () => {
    if (!sitePasswordInput.trim()) return;
    setLoginLoading(true);
    try {
      const ok = await apiVerifyToken(sitePasswordInput);
      if (ok) {
        localStorage.setItem(SITE_AUTH_KEY, sitePasswordInput);
        setSiteAuthenticated(true);
        setSitePasswordError(false);
      } else {
        setSitePasswordError(true);
      }
    } catch {
      setSitePasswordError(true);
    } finally {
      setLoginLoading(false);
    }
  };

  // ── Data from the server ────────────────────────────────
  const { data: serverData, isLoading: dataLoading } = useQuery<AppData>({
    queryKey: ["/api/data"],
    queryFn: apiLoadData,
    enabled: siteAuthenticated, // don't fetch until user has logged in
  });

  // One-time migration: if localStorage has data and DB is empty, push it
  const [migrationDone, setMigrationDone] = useState(false);
  useEffect(() => {
    if (!serverData || migrationDone) return;
    const alreadyMigrated = localStorage.getItem(MIGRATED_KEY) === "true";
    const dbEmpty = serverData.folders.length === 0 && serverData.tiles.length === 0;
    const localData = loadLocalData();
    if (dbEmpty && localData && !alreadyMigrated) {
      console.log("[migration] Pushing localStorage data to database...");
      apiSaveAll(localData).then(() => {
        localStorage.setItem(MIGRATED_KEY, "true");
        queryClient.invalidateQueries({ queryKey: ["/api/data"] });
        setMigrationDone(true);
        console.log("[migration] Done.");
      }).catch((err) => {
        console.error("[migration] Failed:", err);
        setMigrationDone(true);
      });
    } else {
      setMigrationDone(true);
    }
  }, [serverData, migrationDone, queryClient]);

  // Local state is derived from server data
  const [data, setData] = useState<AppData>(EMPTY_DATA);
  useEffect(() => {
    if (serverData) {
      setData(serverData);
    }
  }, [serverData]);

  const [search, setSearch] = useState("");
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [editingTile, setEditingTile] = useState<TemplateTile | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editFolderId, setEditFolderId] = useState<string | null>(null);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderDialogMode, setFolderDialogMode] = useState<"add" | "rename">("add");
  const [folderName, setFolderName] = useState("");
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [deleteFolderConfirmId, setDeleteFolderConfirmId] = useState<string | null>(null);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordDialogMode, setPasswordDialogMode] = useState<"unlock" | "set" | "remove">("unlock");
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordFolderId, setPasswordFolderId] = useState<string | null>(null);
  const [unlockedFolders, setUnlockedFolders] = useState<Set<string>>(new Set());
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [draggingTileId, setDraggingTileId] = useState<string | null>(null);
  const [previewTileId, setPreviewTileId] = useState<string | null>(null);
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);
  const [folderDropTargetId, setFolderDropTargetId] = useState<string | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [vaultSectionsOpen, setVaultSectionsOpen] = useState(false);
  const [restoringTrashId, setRestoringTrashId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderIcon, setNewFolderIcon] = useState("");
  const [newFolderColor, setNewFolderColor] = useState("#3b82f6");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [editingFolderIcon, setEditingFolderIcon] = useState("");
  const [editingFolderColor, setEditingFolderColor] = useState("");
  // Feature 1: Variable placeholders
  const [fillDialogOpen, setFillDialogOpen] = useState(false);
  const [fillPlaceholders, setFillPlaceholders] = useState<{key: string; value: string}[]>([]);
  const [fillTileBody, setFillTileBody] = useState("");
  const [fillTileTitle, setFillTileTitle] = useState("");
  // Feature 2: Favorites
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(FAVORITES_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  // Feature 4: Recent copies
  const [recentCopies, setRecentCopies] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(RECENT_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { folders, tiles } = data;

  // Save status indicator for user feedback
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Connection status (persistent indicator in the header)
  const [connectionStatus, setConnectionStatus] = useState<"checking" | "online" | "offline">("checking");
  // Tile ids whose last save attempt has not been confirmed by the server.
  // Increases on save start, decreases on success, stays incremented on failure.
  const [pendingSaveIds, setPendingSaveIds] = useState<Set<string>>(new Set());
  const pendingCount = pendingSaveIds.size;

  const markPending = useCallback((id: string) => {
    setPendingSaveIds(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const clearPending = useCallback((id: string) => {
    setPendingSaveIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const showSaveError = useCallback((action: string) => {
    setSaveStatus("error");
    setConnectionStatus("offline");
    toast({
      title: "Save failed",
      description: `Could not ${action}. Check the connection indicator before refreshing.`,
      variant: "destructive",
      duration: 8000,
    });
  }, [toast]);

  const showSaveSuccess = useCallback(() => {
    setSaveStatus("saved");
    setConnectionStatus("online");
    if (saveStatusTimeoutRef.current) clearTimeout(saveStatusTimeoutRef.current);
    saveStatusTimeoutRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
  }, []);

  // Periodic health-check so the connection dot reflects reality even when idle.
  useEffect(() => {
    if (!siteAuthenticated) return;
    let cancelled = false;
    const ping = async () => {
      try {
        const token = localStorage.getItem(SITE_AUTH_KEY);
        const res = await fetch("/api/data", {
          method: "GET",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!cancelled) setConnectionStatus(res.ok ? "online" : "offline");
      } catch {
        if (!cancelled) setConnectionStatus("offline");
      }
    };
    ping();
    const interval = setInterval(ping, 20_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [siteAuthenticated]);

  // Warn before refresh/close if any save is unconfirmed.
  useEffect(() => {
    if (pendingCount === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [pendingCount]);

  // Granular save helpers — each action persists individually
  const persistTile = useCallback(async (tile: TemplateTile) => {
    setSaveStatus("saving");
    markPending(tile.id);
    try {
      await apiUpsertTile(tile);
      clearPending(tile.id);
      showSaveSuccess();
    } catch (err) {
      console.error("Save tile failed:", err);
      showSaveError("save tile");
    }
  }, [showSaveSuccess, showSaveError, markPending, clearPending]);

  const persistDeleteTile = useCallback(async (id: string): Promise<string | null> => {
    setSaveStatus("saving");
    markPending(id);
    try {
      const trashId = await apiDeleteTile(id);
      clearPending(id);
      showSaveSuccess();
      return trashId;
    } catch (err) {
      console.error("Delete tile failed:", err);
      showSaveError("delete tile");
      return null;
    }
  }, [showSaveSuccess, showSaveError, markPending, clearPending]);

  const persistFolder = useCallback(async (folder: Folder) => {
    setSaveStatus("saving");
    markPending(`folder:${folder.id}`);
    try {
      await apiUpsertFolder(folder);
      clearPending(`folder:${folder.id}`);
      showSaveSuccess();
    } catch (err) {
      console.error("Save folder failed:", err);
      showSaveError("save folder");
    }
  }, [showSaveSuccess, showSaveError, markPending, clearPending]);

  const persistDeleteFolder = useCallback(async (id: string): Promise<string | null> => {
    setSaveStatus("saving");
    markPending(`folder:${id}`);
    try {
      const trashId = await apiDeleteFolder(id);
      clearPending(`folder:${id}`);
      showSaveSuccess();
      return trashId;
    } catch (err) {
      console.error("Delete folder failed:", err);
      showSaveError("delete folder");
      return null;
    }
  }, [showSaveSuccess, showSaveError, markPending, clearPending]);

  const persistImport = useCallback(async (importData: AppData) => {
    setSaveStatus("saving");
    markPending("import");
    try {
      await apiSaveAll(importData);
      clearPending("import");
      showSaveSuccess();
    } catch (err) {
      console.error("Import failed:", err);
      showSaveError("import data");
    }
  }, [showSaveSuccess, showSaveError, markPending, clearPending]);

  // Shared undo handler for tile/folder soft-deletes. Calls the
  // server-side restore endpoint and refreshes both the live data
  // and the trash listing. Surfaces a clear error if the restore is
  // refused (e.g. the original id was recreated in the meantime).
  const undoDelete = useCallback(async (trashId: string) => {
    const result = await apiRestoreFromTrash(trashId);
    if (result.ok) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/data"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/trash"] }),
      ]);
      toast({ title: "Restored", duration: 1500 });
    } else {
      toast({
        title: "Undo failed",
        description:
          result.reason === "id_exists"
            ? "An item with this id already exists in the live list."
            : result.reason === "not_found"
              ? "The trash entry has expired or was already restored."
              : `Restore refused: ${result.reason}`,
        variant: "destructive",
        duration: 4500,
      });
    }
  }, [queryClient, toast]);

  // Persist favorites
  useEffect(() => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favoriteIds]));
  }, [favoriteIds]);

  // Persist recent copies
  useEffect(() => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentCopies));
  }, [recentCopies]);

  // Feature 3: Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      const anyDialogOpen = editDialogOpen || importDialogOpen || folderDialogOpen || passwordDialogOpen || fillDialogOpen || adminOpen || trashOpen;

      if (e.key === "Escape") {
        if (fillDialogOpen) { setFillDialogOpen(false); return; }
        if (anyDialogOpen) return; // let dialog handle it
        if (search) { setSearch(""); return; }
        if (previewTileId) { setPreviewTileId(null); return; }
        if (openFolderId) { setOpenFolderId(null); return; }
        return;
      }
      if (isInput) return;
      if (anyDialogOpen) return;
      if (e.key === "/" ) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        addTile();
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editDialogOpen, importDialogOpen, folderDialogOpen, passwordDialogOpen, fillDialogOpen, adminOpen, trashOpen, search, previewTileId, openFolderId]);

  const toggleFavorite = (tileId: string) => {
    setFavoriteIds(prev => {
      const next = new Set(prev);
      if (next.has(tileId)) next.delete(tileId);
      else next.add(tileId);
      return next;
    });
  };

  const addToRecent = (tileId: string) => {
    setRecentCopies(prev => {
      const next = [tileId, ...prev.filter(id => id !== tileId)].slice(0, 5);
      return next;
    });
  };

  const setTiles = (updater: (prev: TemplateTile[]) => TemplateTile[]) => {
    setData((prev) => ({ ...prev, tiles: updater(prev.tiles) }));
  };

  const setFolders = (updater: (prev: Folder[]) => Folder[]) => {
    setData((prev) => ({ ...prev, folders: updater(prev.folders) }));
  };

  const isOnDashboard = openFolderId === null;
  const currentFolderName = openFolderId
    ? folders.find((f) => f.id === openFolderId)?.name || "Folder"
    : null;

  const visibleTiles = openFolderId
    ? tiles.filter((t) => t.folderId === openFolderId)
    : [];

  const filteredTiles = search.trim()
    ? (isOnDashboard ? tiles : visibleTiles).filter((tile) => {
        const q = search.toLowerCase();
        return tile.title.toLowerCase().includes(q) || tile.body.toLowerCase().includes(q);
      })
    : visibleTiles;

  const searchResultsGlobal = isOnDashboard && search.trim()
    ? tiles.filter((tile) => {
        const q = search.toLowerCase();
        return tile.title.toLowerCase().includes(q) || tile.body.toLowerCase().includes(q);
      })
    : null;

  const doCopy = useCallback(
    async (text: string, title: string, tileId: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedId(tileId);
        addToRecent(tileId);
        if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
        copiedTimeoutRef.current = setTimeout(() => setCopiedId(null), 1500);
        toast({
          title: "Copied!",
          description: `"${title}" copied to clipboard`,
          duration: 2000,
        });
      } catch {
        toast({
          title: "Clipboard unavailable",
          description: "Your browser blocked clipboard access. Please select the text manually and press Ctrl+C / Cmd+C.",
          variant: "destructive",
          duration: 5000,
        });
      }
    },
    [toast]
  );

  const copyToClipboard = useCallback(
    async (tile: TemplateTile) => {
      await doCopy(tile.body, tile.title, tile.id);
    },
    [doCopy]
  );

  const completeFill = async () => {
    let result = fillTileBody;
    for (const p of fillPlaceholders) {
      if (p.value.trim()) {
        result = result.replaceAll(`[${p.key}]`, p.value);
      }
    }
    setFillDialogOpen(false);
    await doCopy(result, fillTileTitle, copiedId || "");
  };

  const addTile = () => {
    const defaultFolder = openFolderId;
    const newTile: TemplateTile = {
      id: generateId(),
      title: "",
      body: "",
      folderId: defaultFolder,
    };
    setEditTitle("");
    setEditBody("");
    setEditFolderId(defaultFolder);
    setEditingTile(newTile);
    setEditDialogOpen(true);
  };

  const startEdit = (tile: TemplateTile) => {
    setEditTitle(tile.title);
    setEditBody(tile.body);
    setEditFolderId(tile.folderId);
    setEditingTile(tile);
    setEditDialogOpen(true);
  };

  const saveEdit = () => {
    if (!editingTile) return;
    const updated: TemplateTile = {
      ...editingTile,
      title: editTitle.trim() || "Untitled",
      body: editBody,
      folderId: editFolderId,
    };
    setTiles((prev) => {
      const exists = prev.find((t) => t.id === updated.id);
      if (exists) {
        return prev.map((t) => (t.id === updated.id ? updated : t));
      }
      return [...prev, updated];
    });
    persistTile(updated);
    setEditDialogOpen(false);
    setEditingTile(null);
  };

  const deleteTile = async (id: string) => {
    setTiles((prev) => prev.filter((t) => t.id !== id));
    if (previewTileId === id) setPreviewTileId(null);
    const trashId = await persistDeleteTile(id);
    if (trashId) {
      toast({
        title: "Tile deleted",
        description: "Recoverable for 30 days from Admin → Trash Bin.",
        action: (
          <ToastAction altText="Undo" onClick={() => undoDelete(trashId)}>
            Undo
          </ToastAction>
        ),
        duration: 5000,
      });
    }
  };

  const moveTileToFolder = (tileId: string, targetFolderId: string | null) => {
    let movedTile: TemplateTile | undefined;
    setTiles((prev) =>
      prev.map((t) => {
        if (t.id === tileId) {
          movedTile = { ...t, folderId: targetFolderId };
          return movedTile;
        }
        return t;
      })
    );
    if (movedTile) persistTile(movedTile);
    const folderLabel = targetFolderId
      ? folders.find((f) => f.id === targetFolderId)?.name || "folder"
      : "Uncategorized";
    toast({
      title: "Moved",
      description: `Template moved to ${folderLabel}`,
      duration: 1500,
    });
  };

  const openAddFolder = () => {
    setFolderDialogMode("add");
    setFolderName("");
    setRenamingFolderId(null);
    setFolderDialogOpen(true);
  };

  const openRenameFolder = (folder: Folder) => {
    setFolderDialogMode("rename");
    setFolderName(folder.name);
    setRenamingFolderId(folder.id);
    setFolderDialogOpen(true);
  };

  const saveFolder = () => {
    const name = folderName.trim();
    if (!name) return;
    if (folderDialogMode === "add") {
      const newFolder: Folder = { id: generateId(), name };
      setFolders((prev) => [...prev, newFolder]);
      persistFolder(newFolder);
      toast({ title: "Folder created", description: `"${name}" added`, duration: 2000 });
    } else if (renamingFolderId) {
      let updatedFolder: Folder | undefined;
      setFolders((prev) =>
        prev.map((f) => {
          if (f.id === renamingFolderId) {
            updatedFolder = { ...f, name };
            return updatedFolder;
          }
          return f;
        })
      );
      if (updatedFolder) persistFolder(updatedFolder);
      toast({ title: "Folder renamed", description: `Renamed to "${name}"`, duration: 2000 });
    }
    setFolderDialogOpen(false);
  };

  const deleteFolder = async (folderId: string) => {
    // Server-side, deleteFolder snapshots the folder AND its tiles into
    // trash under one groupId, so tiles are removed (not orphaned to
    // Uncategorized). Mirror that in the optimistic UI state — and on
    // Undo, both come back together via the shared groupId.
    setData((prev) => ({
      folders: prev.folders.filter((f) => f.id !== folderId),
      tiles: prev.tiles.filter((t) => t.folderId !== folderId),
    }));
    if (openFolderId === folderId) setOpenFolderId(null);
    setDeleteFolderConfirmId(null);
    const trashId = await persistDeleteFolder(folderId);
    if (trashId) {
      toast({
        title: "Folder deleted",
        description:
          "Folder and its templates recoverable for 30 days from Admin → Trash Bin.",
        action: (
          <ToastAction altText="Undo" onClick={() => undoDelete(trashId)}>
            Undo
          </ToastAction>
        ),
        duration: 5000,
      });
    }
  };

  const createNewFolder = async () => {
    if (!newFolderName.trim()) {
      toast({ title: "Please enter a section name", variant: "destructive" });
      return;
    }
    const newFolder: Folder = {
      id: generateId(),
      name: newFolderName.trim(),
      icon: newFolderIcon || "",
      color: newFolderColor || "#3b82f6",
      sortOrder: folders.length,
    };
    setData((prev) => ({ ...prev, folders: [...prev.folders, newFolder] }));
    setNewFolderName("");
    setNewFolderIcon("");
    setNewFolderColor("#3b82f6");
    await persistFolder(newFolder);
    toast({ title: "Section created", duration: 2000 });
  };

  const updateFolder = async (
    folderId: string | null,
    updates: { name?: string; icon?: string; color?: string },
  ) => {
    if (!folderId) return;
    setData((prev) => ({
      ...prev,
      folders: prev.folders.map((f) =>
        f.id === folderId ? { ...f, ...updates } : f,
      ),
    }));
    const updated = { ...folders.find((f) => f.id === folderId)!, ...updates };
    await persistFolder(updated);
    toast({ title: "Section updated", duration: 2000 });
  };

  const openFolderWithPasswordCheck = (folderId: string) => {
    const folder = folders.find((f) => f.id === folderId);
    if (folder?.password && !unlockedFolders.has(folderId)) {
      setPasswordFolderId(folderId);
      setPasswordDialogMode("unlock");
      setPasswordInput("");
      setPasswordDialogOpen(true);
    } else {
      setOpenFolderId(folderId);
      setPreviewTileId(null);
      setSearch("");
    }
  };

  const handlePasswordSubmit = () => {
    const folder = folders.find((f) => f.id === passwordFolderId);
    if (!folder) return;

    if (passwordDialogMode === "unlock") {
      if (passwordInput === folder.password) {
        setUnlockedFolders((prev) => new Set(prev).add(folder.id));
        setOpenFolderId(folder.id);
        setPreviewTileId(null);
        setSearch("");
        setPasswordDialogOpen(false);
        setPasswordInput("");
        toast({ title: "Folder unlocked", duration: 1500 });
      } else {
        toast({ title: "Wrong password", variant: "destructive", duration: 2000 });
      }
    } else if (passwordDialogMode === "set") {
      if (passwordInput.trim()) {
        const updatedFolder = { ...folder, password: passwordInput.trim() };
        setFolders((prev) =>
          prev.map((f) => (f.id === folder.id ? updatedFolder : f))
        );
        persistFolder(updatedFolder);
        setPasswordDialogOpen(false);
        setPasswordInput("");
        toast({ title: "Password set", description: `"${folder.name}" is now protected`, duration: 2000 });
      }
    } else if (passwordDialogMode === "remove") {
      if (passwordInput === folder.password) {
        const updatedFolder = { ...folder, password: undefined };
        setFolders((prev) =>
          prev.map((f) => (f.id === folder.id ? updatedFolder : f))
        );
        persistFolder(updatedFolder);
        setUnlockedFolders((prev) => {
          const next = new Set(prev);
          next.delete(folder.id);
          return next;
        });
        setPasswordDialogOpen(false);
        setPasswordInput("");
        toast({ title: "Password removed", description: `"${folder.name}" is now open`, duration: 2000 });
      } else {
        toast({ title: "Wrong password", variant: "destructive", duration: 2000 });
      }
    }
  };

  const openSetPassword = (folderId: string) => {
    setPasswordFolderId(folderId);
    setPasswordDialogMode("set");
    setPasswordInput("");
    setPasswordDialogOpen(true);
  };

  const openRemovePassword = (folderId: string) => {
    setPasswordFolderId(folderId);
    setPasswordDialogMode("remove");
    setPasswordInput("");
    setPasswordDialogOpen(true);
  };

  const exportTemplates = () => {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template-tiles.json";
    a.click();
    URL.revokeObjectURL(url);
    toast({
      title: "Exported",
      description: `${tiles.length} templates and ${folders.length} folders exported`,
      duration: 2000,
    });
  };

  const downloadContentBackup = () => {
    const backup = {
      exportDate: new Date().toISOString(),
      appVersion: APP_VERSION,
      data: data,
    };
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `template-tiles-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({
      title: "Backup Downloaded",
      description: `${tiles.length} templates and ${folders.length} folders backed up`,
      duration: 2000,
    });
  };

  const downloadAllCode = () => {
    window.open("https://github.com/1903978-prog/template-tiles/archive/refs/heads/main.zip", "_blank");
    toast({
      title: "Code Download Started",
      description: "Downloading source code from GitHub",
      duration: 2000,
    });
  };

  const handleImport = () => {
    try {
      const parsed = JSON.parse(importText);
      const validateTiles = (arr: any[]) =>
        arr.every((t: any) => typeof t.title === "string" && typeof t.body === "string");
      const validateFolders = (arr: any[]) =>
        arr.every((f: any) => typeof f.id === "string" && typeof f.name === "string");

      if (parsed.folders && parsed.tiles) {
        if (!Array.isArray(parsed.folders) || !Array.isArray(parsed.tiles))
          throw new Error("Invalid format");
        if (!validateFolders(parsed.folders) || !validateTiles(parsed.tiles))
          throw new Error("Invalid structure");
        const importData: AppData = {
          folders: parsed.folders,
          tiles: parsed.tiles.map((t: any) => ({
            id: t.id || generateId(),
            title: t.title,
            body: t.body,
            folderId: t.folderId ?? null,
          })),
        };
        setData(importData);
        persistImport(importData);
      } else if (Array.isArray(parsed)) {
        if (!validateTiles(parsed)) throw new Error("Invalid structure");
        const importTiles = parsed.map((t: any) => ({
          id: t.id || generateId(),
          title: t.title,
          body: t.body,
          folderId: t.folderId ?? null,
        }));
        setData((prev) => {
          const newData = { ...prev, tiles: importTiles };
          persistImport(newData);
          return newData;
        });
      } else {
        throw new Error("Invalid format");
      }
      setImportDialogOpen(false);
      setImportText("");
      setOpenFolderId(null);
      toast({ title: "Imported", description: "Templates imported successfully", duration: 2000 });
    } catch {
      toast({
        title: "Import failed",
        description: "Invalid JSON format. Expected {folders, tiles} or an array of templates.",
        variant: "destructive",
        duration: 4000,
      });
    }
  };

  const handleTileDragStart = (e: React.DragEvent, tileId: string) => {
    e.dataTransfer.setData("text/plain", tileId);
    e.dataTransfer.effectAllowed = "move";
    setDraggingTileId(tileId);
  };

  const handleTileDragEnd = () => {
    setDraggingTileId(null);
    setDragOverFolderId(null);
  };

  const handleFolderDragOver = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverFolderId(folderId);
  };

  const handleFolderDragLeave = () => {
    setDragOverFolderId(null);
  };

  const handleFolderDrop = (e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault();
    const tileId = e.dataTransfer.getData("text/plain");
    if (tileId) {
      moveTileToFolder(tileId, targetFolderId);
    }
    setDragOverFolderId(null);
    setDraggingTileId(null);
  };

  const handleFolderCardDragStart = (e: React.DragEvent, folderId: string) => {
    e.dataTransfer.setData("application/folder-id", folderId);
    e.dataTransfer.effectAllowed = "move";
    setDraggingFolderId(folderId);
  };

  const handleFolderCardDragEnd = () => {
    setDraggingFolderId(null);
    setFolderDropTargetId(null);
  };

  const handleFolderCardDragOver = (e: React.DragEvent, targetFolderId: string) => {
    if (!draggingFolderId || draggingFolderId === targetFolderId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setFolderDropTargetId(targetFolderId);
  };

  const handleFolderCardDrop = (e: React.DragEvent, targetFolderId: string) => {
    e.preventDefault();
    const sourceFolderId = e.dataTransfer.getData("application/folder-id");
    if (!sourceFolderId || sourceFolderId === targetFolderId) {
      setDraggingFolderId(null);
      setFolderDropTargetId(null);
      return;
    }
    setFolders((prev) => {
      const fromIndex = prev.findIndex((f) => f.id === sourceFolderId);
      const toIndex = prev.findIndex((f) => f.id === targetFolderId);
      if (fromIndex === -1 || toIndex === -1) return prev;
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      // Persist new sort orders
      updated.forEach((f, i) => {
        persistFolder({ ...f, sortOrder: i });
      });
      return updated;
    });
    setDraggingFolderId(null);
    setFolderDropTargetId(null);
  };

  const uncategorizedTiles = tiles.filter((t) => t.folderId === null);
  const uncategorizedCount = uncategorizedTiles.length;

  const previewTile = previewTileId ? tiles.find((t) => t.id === previewTileId) : null;

  const renderTileCard = (tile: TemplateTile) => {
    const isCopied = copiedId === tile.id;
    const isDragging = draggingTileId === tile.id;
    const isPreviewed = previewTileId === tile.id;
    const isFavorite = favoriteIds.has(tile.id);

    return (
      <div
        key={tile.id}
        data-testid={`card-tile-${tile.id}`}
        draggable
        onDragStart={(e) => handleTileDragStart(e, tile.id)}
        onDragEnd={handleTileDragEnd}
        className={`group relative border rounded-md bg-card transition-all duration-200 cursor-pointer hover-elevate ${
          isPreviewed ? "ring-2 ring-primary border-primary/50" : isCopied ? "ring-2 ring-primary/50" : ""
        } ${isDragging ? "opacity-40" : ""}`}
        style={{ aspectRatio: "1 / 1" }}
        onClick={() => {
          copyToClipboard(tile);
          setPreviewTileId(tile.id);
        }}
      >
        <div className="absolute inset-0 flex flex-col p-4 overflow-hidden rounded-md">
          <div className="flex items-start justify-between gap-1 mb-1">
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0 cursor-grab" />
              <h3
                className="text-sm font-semibold leading-tight truncate"
                data-testid={`text-tile-title-${tile.id}`}
              >
                {tile.title || "Untitled"}
              </h3>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                className={`p-1 rounded-sm transition-colors ${isFavorite ? "visible opacity-100 text-yellow-400" : "invisible opacity-0 group-hover:visible group-hover:opacity-100 text-muted-foreground hover:text-yellow-400"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(tile.id);
                }}
                title={isFavorite ? "Unpin" : "Pin to top"}
              >
                <Star className={`w-3.5 h-3.5 ${isFavorite ? "fill-yellow-400" : ""}`} />
              </button>
              <button
                data-testid={`button-copy-tile-${tile.id}`}
                className="p-1 rounded-sm text-muted-foreground hover:text-foreground transition-colors invisible opacity-0 group-hover:visible group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  copyToClipboard(tile);
                }}
                title="Copy"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                data-testid={`button-edit-${tile.id}`}
                className="p-1 rounded-sm text-muted-foreground hover:text-foreground transition-colors invisible opacity-0 group-hover:visible group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  startEdit(tile);
                }}
                title="Edit"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                data-testid={`button-delete-${tile.id}`}
                className="p-1 rounded-sm text-muted-foreground hover:text-destructive transition-colors invisible opacity-0 group-hover:visible group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteTile(tile.id);
                }}
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {isOnDashboard && tile.folderId && (
            <span className="text-[10px] text-muted-foreground/60 mb-1 truncate">
              {folders.find((f) => f.id === tile.folderId)?.name}
            </span>
          )}

          <p
            className="text-xs text-muted-foreground leading-relaxed flex-1 whitespace-pre-wrap overflow-hidden"
            data-testid={`text-tile-body-${tile.id}`}
          >
            {tile.body || "Empty template"}
          </p>

          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
            {isCopied ? (
              <span className="text-xs font-medium text-primary flex items-center gap-1" data-testid={`text-copied-${tile.id}`}>
                <Check className="w-3 h-3" />
                Copied!
              </span>
            ) : (
              <span className="text-xs text-muted-foreground/60 flex items-center gap-1">
                <FileText className="w-3 h-3" />
                Click to preview
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Compact title-only row used on phones: tap copies the body to the
  // clipboard so many templates can be scanned in a tight vertical list.
  const renderTileRow = (tile: TemplateTile) => {
    const isCopied = copiedId === tile.id;
    const isFavorite = favoriteIds.has(tile.id);

    return (
      <div
        key={tile.id}
        data-testid={`card-tile-${tile.id}`}
        className={`group relative flex items-center gap-2 border rounded-md bg-card px-3 py-2.5 cursor-pointer active:bg-muted/50 transition-colors ${
          isCopied ? "ring-2 ring-primary/50" : ""
        }`}
        onClick={() => copyToClipboard(tile)}
      >
        {isCopied ? (
          <Check className="w-4 h-4 text-primary shrink-0" />
        ) : (
          <Copy className="w-4 h-4 text-muted-foreground/50 shrink-0" />
        )}
        <span
          className="text-sm font-medium truncate flex-1 min-w-0"
          data-testid={`text-tile-title-${tile.id}`}
        >
          {tile.title || "Untitled"}
        </span>
        <button
          className={`p-1 rounded-sm shrink-0 ${isFavorite ? "text-yellow-400" : "text-muted-foreground/60"}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(tile.id);
          }}
          title={isFavorite ? "Unpin" : "Pin to top"}
        >
          <Star className={`w-4 h-4 ${isFavorite ? "fill-yellow-400" : ""}`} />
        </button>
        <button
          data-testid={`button-edit-${tile.id}`}
          className="p-1 rounded-sm text-muted-foreground/60 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            startEdit(tile);
          }}
          title="Edit"
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          data-testid={`button-delete-${tile.id}`}
          className="p-1 rounded-sm text-muted-foreground/60 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            deleteTile(tile.id);
          }}
          title="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    );
  };

  const renderTile = isMobile ? renderTileRow : renderTileCard;
  const tileContainerClass = isMobile ? "flex flex-col gap-2" : "grid gap-4";
  const tileContainerStyle = isMobile
    ? undefined
    : { gridTemplateColumns: "repeat(auto-fill, minmax(min(220px, 100%), 1fr))" };

  if (!siteAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-full max-w-sm mx-auto p-8">
          <div className="flex flex-col items-center mb-8">
            <Lock className="w-12 h-12 text-primary mb-4" />
            <h1 className="text-2xl font-bold text-foreground">Template Tiles</h1>
            <p className="text-sm text-muted-foreground mt-2">Enter password to access</p>
          </div>
          <div className="space-y-4">
            <Input
              type="password"
              placeholder="Password"
              value={sitePasswordInput}
              onChange={(e) => {
                setSitePasswordInput(e.target.value);
                setSitePasswordError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSiteLogin();
              }}
              className={`${sitePasswordError ? "border-destructive animate-[shake_0.3s_ease-in-out]" : ""}`}
              autoFocus
            />
            {sitePasswordError && (
              <p className="text-sm text-destructive font-medium mt-1">Incorrect password</p>
            )}
            <Button onClick={handleSiteLogin} className="w-full" disabled={!sitePasswordInput.trim() || loginLoading}>
              {loginLoading ? "Checking..." : "Enter"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (dataLoading || !migrationDone) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-2 sm:gap-3 h-14 sm:h-16 flex-wrap">
            <div className="flex items-center gap-2 shrink-0">
              <LayoutGrid className="w-5 h-5 text-primary" />
              <h1 className="text-base sm:text-lg font-semibold tracking-tight" data-testid="text-app-title">
                Template Tiles
              </h1>
            </div>

            <div className="flex items-center gap-2 flex-1 min-w-0 max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  data-testid="input-search"
                  type="search"
                  placeholder={isOnDashboard ? "Search all templates..." : `Search in ${currentFolderName}...`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0 flex-wrap">
              {/* Persistent connection indicator — always visible so you can verify the
                  backend is reachable BEFORE you save or refresh. */}
              <span
                className={`text-xs px-2 py-1 rounded-full inline-flex items-center gap-1.5 ${
                  connectionStatus === "online"
                    ? "text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-950/30"
                    : connectionStatus === "offline"
                    ? "text-destructive bg-destructive/10"
                    : "text-muted-foreground bg-muted"
                }`}
                title={
                  connectionStatus === "online"
                    ? "Connected to server. Saves will persist."
                    : connectionStatus === "offline"
                    ? "Server unreachable. Don't refresh — your latest changes may not be saved yet."
                    : "Checking server..."
                }
                data-testid="connection-status"
              >
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    connectionStatus === "online"
                      ? "bg-green-500"
                      : connectionStatus === "offline"
                      ? "bg-destructive"
                      : "bg-muted-foreground animate-pulse"
                  }`}
                />
                {connectionStatus === "online" ? "Online" : connectionStatus === "offline" ? "Offline" : "Checking"}
              </span>
              {pendingCount > 0 && (
                <span
                  className="text-xs px-2 py-1 rounded-full text-orange-700 bg-orange-50 dark:text-orange-400 dark:bg-orange-950/30 font-medium"
                  title="There are unsaved changes. Don't refresh until this clears."
                  data-testid="pending-saves"
                >
                  {pendingCount} unsaved
                </span>
              )}
              {saveStatus !== "idle" && pendingCount === 0 && (
                <span className={`text-xs px-2 py-1 rounded-full ${
                  saveStatus === "saving" ? "text-muted-foreground bg-muted" :
                  saveStatus === "saved" ? "text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950/30" :
                  "text-destructive bg-destructive/10"
                }`}>
                  {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save error"}
                </span>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={exportTemplates}
                data-testid="button-export-db"
              >
                <Database className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Export DB</span>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={downloadAllCode}
                data-testid="button-export-code"
              >
                <Code className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Export Code</span>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setImportDialogOpen(true)}
                data-testid="button-import"
              >
                <Upload className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Import</span>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setAdminOpen(true)}
                data-testid="button-admin"
              >
                <Settings className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Admin</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex gap-6">
          <div className="flex-1 min-w-0">

        {/* Feature 2: Pinned tiles section */}
        {isOnDashboard && !searchResultsGlobal && (() => {
          const pinnedTiles = tiles.filter(t => favoriteIds.has(t.id));
          if (pinnedTiles.length === 0) return null;
          return (
            <div className="mb-6">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2 mb-3">
                <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                Pinned
                <span className="text-sm font-normal text-muted-foreground">({pinnedTiles.length})</span>
              </h2>
              <div className={tileContainerClass} style={tileContainerStyle}>
                {pinnedTiles.map(renderTile)}
              </div>
            </div>
          );
        })()}

        {/* Feature 4: Recent copies section */}
        {isOnDashboard && !searchResultsGlobal && (() => {
          const recentTiles = recentCopies.map(id => tiles.find(t => t.id === id)).filter(Boolean) as TemplateTile[];
          if (recentTiles.length === 0) return null;
          return (
            <div className="mb-6">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-muted-foreground" />
                Recent
              </h2>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {recentTiles.map(tile => (
                  <button
                    key={tile.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-md border bg-card hover:bg-muted/50 transition-colors shrink-0 max-w-[200px]"
                    onClick={() => { copyToClipboard(tile); setPreviewTileId(tile.id); }}
                  >
                    <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate">{tile.title || "Untitled"}</span>
                    <Copy className="w-3 h-3 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-foreground" data-testid="text-section-folders">Folders</h2>
          <Button size="sm" variant="secondary" onClick={openAddFolder} data-testid="button-add-folder">
            <FolderPlus className="w-4 h-4 mr-1" />
            New folder
          </Button>
        </div>

        <div
          className="grid gap-3 sm:gap-4 mb-6 grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]"
          data-testid="grid-folders"
        >
              {folders.map((folder) => {
                const count = tiles.filter((t) => t.folderId === folder.id).length;
                const isConfirmingDelete = deleteFolderConfirmId === folder.id;
                const isDragOver = dragOverFolderId === folder.id;
                const isMoveTarget = previewTileId !== null && uncategorizedTiles.some((t) => t.id === previewTileId);
                const isActive = openFolderId === folder.id;

                const isFolderDragging = draggingFolderId === folder.id;
                const isFolderDropTarget = folderDropTargetId === folder.id;

                return (
                  <div
                    key={folder.id}
                    data-testid={`card-folder-${folder.id}`}
                    draggable
                    onDragStart={(e) => handleFolderCardDragStart(e, folder.id)}
                    onDragEnd={handleFolderCardDragEnd}
                    className={`group/folder relative border rounded-md cursor-pointer hover-elevate transition-all duration-200 ${
                      isFolderDragging
                        ? "opacity-40"
                        : isFolderDropTarget && draggingFolderId
                          ? "ring-2 ring-blue-400 border-blue-400 bg-blue-50 dark:bg-blue-950/30"
                          : isMoveTarget
                            ? "bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-700 hover:bg-green-100 dark:hover:bg-green-900/40 hover:border-green-400 dark:hover:border-green-600"
                            : isActive
                              ? "ring-2 ring-primary border-primary/50 bg-primary/5"
                              : isDragOver
                                ? "ring-2 ring-primary border-primary/50 bg-primary/5 bg-card"
                                : "bg-card"
                    }`}
                    style={{ aspectRatio: "4 / 3" }}
                    onClick={() => {
                      if (draggingFolderId) return;
                      if (isActive) {
                        setOpenFolderId(null);
                        setSearch("");
                        setPreviewTileId(null);
                      } else if (isMoveTarget && previewTileId) {
                        moveTileToFolder(previewTileId, folder.id);
                        setPreviewTileId(null);
                      } else {
                        openFolderWithPasswordCheck(folder.id);
                      }
                    }}
                    onDragOver={(e) => {
                      if (draggingFolderId) {
                        handleFolderCardDragOver(e, folder.id);
                      } else {
                        handleFolderDragOver(e, folder.id);
                      }
                    }}
                    onDragLeave={() => {
                      handleFolderDragLeave();
                      setFolderDropTargetId(null);
                    }}
                    onDrop={(e) => {
                      if (draggingFolderId) {
                        handleFolderCardDrop(e, folder.id);
                      } else {
                        handleFolderDrop(e, folder.id);
                      }
                    }}
                  >
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-4 rounded-md" style={folder.color ? { backgroundColor: `${folder.color}15` } : undefined}>
                      {folder.icon ? (
                        <span className="text-4xl mb-3">{folder.icon}</span>
                      ) : (
                        <FolderOpen className={`w-10 h-10 mb-3 transition-colors ${
                          isMoveTarget ? "text-green-500 dark:text-green-400" : isDragOver ? "text-primary" : "text-muted-foreground/50"
                        }`} />
                      )}
                      <h3 className="text-sm font-semibold text-center truncate w-full" data-testid={`text-folder-name-${folder.id}`}>
                        {folder.name}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        {isMoveTarget ? "Click to move here" : `${count} ${count === 1 ? "template" : "templates"}`}
                      </p>
                      {folder.password && (
                        <Lock className="w-3.5 h-3.5 text-yellow-500 mt-1.5" />
                      )}
                    </div>
                    <div className="absolute top-2 right-2 invisible group-hover/folder:visible flex items-center gap-0.5">
                      <button
                        className="p-1 rounded-sm text-muted-foreground hover:text-foreground transition-colors bg-card/80 backdrop-blur"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (folder.password) {
                            openRemovePassword(folder.id);
                          } else {
                            openSetPassword(folder.id);
                          }
                        }}
                        title={folder.password ? "Remove password" : "Set password"}
                      >
                        {folder.password ? <Lock className="w-3.5 h-3.5 text-yellow-500" /> : <Unlock className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        data-testid={`button-rename-folder-${folder.id}`}
                        className="p-1 rounded-sm text-muted-foreground hover:text-foreground transition-colors bg-card/80 backdrop-blur"
                        onClick={(e) => {
                          e.stopPropagation();
                          openRenameFolder(folder);
                        }}
                        title="Rename folder"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        data-testid={`button-delete-folder-${folder.id}`}
                        className="p-1 rounded-sm text-muted-foreground hover:text-destructive transition-colors bg-card/80 backdrop-blur"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isConfirmingDelete) {
                            deleteFolder(folder.id);
                          } else {
                            setDeleteFolderConfirmId(folder.id);
                            setTimeout(() => setDeleteFolderConfirmId(null), 3000);
                          }
                        }}
                        title={isConfirmingDelete ? "Click again to confirm" : "Delete folder"}
                      >
                        {isConfirmingDelete ? (
                          <Check className="w-3.5 h-3.5 text-destructive" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

        {isOnDashboard && !searchResultsGlobal && uncategorizedTiles.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-foreground flex items-center gap-2" data-testid="text-section-uncategorized">
                    <Inbox className="w-4 h-4 text-muted-foreground" />
                    Uncategorized
                    <span className="text-sm font-normal text-muted-foreground">({uncategorizedTiles.length})</span>
                  </h2>
                </div>
                <div
                  className={tileContainerClass}
                  style={tileContainerStyle}
                  data-testid="grid-uncategorized"
                >
                  {isMobile ? uncategorizedTiles.map(renderTileRow) : uncategorizedTiles.map((tile) => {
                    const isCopied = copiedId === tile.id;
                    const isDragging = draggingTileId === tile.id;
                    const isPreviewed = previewTileId === tile.id;

                    return (
                      <div key={tile.id} className="flex flex-col gap-2">
                        <div
                          data-testid={`card-tile-${tile.id}`}
                          draggable
                          onDragStart={(e) => handleTileDragStart(e, tile.id)}
                          onDragEnd={handleTileDragEnd}
                          className={`group relative border rounded-md bg-card transition-all duration-200 cursor-pointer hover-elevate ${
                            isPreviewed ? "ring-2 ring-primary border-primary/50" : isCopied ? "ring-2 ring-primary/50" : ""
                          } ${isDragging ? "opacity-40" : ""}`}
                          style={{ aspectRatio: "1 / 1" }}
                          onClick={() => {
                            setPreviewTileId(previewTileId === tile.id ? null : tile.id);
                          }}
                        >
                          <div className="absolute inset-0 flex flex-col p-4 overflow-hidden rounded-md">
                            <div className="flex items-start justify-between gap-1 mb-1">
                              <div className="flex items-center gap-1 flex-1 min-w-0">
                                <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0 cursor-grab" />
                                <h3
                                  className="text-sm font-semibold leading-tight truncate"
                                  data-testid={`text-tile-title-${tile.id}`}
                                >
                                  {tile.title || "Untitled"}
                                </h3>
                              </div>
                              <div className="flex items-center gap-0.5 invisible group-hover:visible transition-opacity opacity-0 group-hover:opacity-100 shrink-0">
                                <button
                                  data-testid={`button-copy-${tile.id}`}
                                  className="p-1 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyToClipboard(tile);
                                  }}
                                  title="Copy"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  data-testid={`button-edit-${tile.id}`}
                                  className="p-1 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEdit(tile);
                                  }}
                                  title="Edit"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  data-testid={`button-delete-${tile.id}`}
                                  className="p-1 rounded-sm text-muted-foreground hover:text-destructive transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteTile(tile.id);
                                  }}
                                  title="Delete"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            <p
                              className="text-xs text-muted-foreground leading-relaxed flex-1 whitespace-pre-wrap overflow-hidden"
                              data-testid={`text-tile-body-${tile.id}`}
                            >
                              {tile.body || "Empty template"}
                            </p>

                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                              {isCopied ? (
                                <span className="text-xs font-medium text-primary flex items-center gap-1" data-testid={`text-copied-${tile.id}`}>
                                  <Check className="w-3 h-3" />
                                  Copied!
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground/60 flex items-center gap-1">
                                  <FolderPlus className="w-3 h-3" />
                                  Click to assign folder
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                      </div>
                    );
                  })}
                </div>
              </>
            )}

        {isOnDashboard && searchResultsGlobal ? (
          <>
            {searchResultsGlobal.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center" data-testid="text-no-results">
                <Search className="w-12 h-12 text-muted-foreground/40 mb-4" />
                <p className="text-lg font-medium text-muted-foreground">No templates found</p>
                <p className="text-sm text-muted-foreground/70 mt-1">Try a different search term</p>
              </div>
            ) : (
              <>
                <h2 className="text-base font-semibold text-foreground mb-4" data-testid="text-section-search-results">
                  Search results ({searchResultsGlobal.length})
                </h2>
                <div
                  className={tileContainerClass}
                  style={tileContainerStyle}
                  data-testid="grid-tiles"
                >
                  {searchResultsGlobal.map(renderTile)}
                </div>
              </>
            )}
          </>
        ) : null}

        {!isOnDashboard ? (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2" data-testid="text-current-folder-label">
                <FolderOpen className="w-4 h-4 text-muted-foreground" />
                {currentFolderName}
              </h2>
              <Button size="sm" onClick={addTile} data-testid="button-add-tile">
                <Plus className="w-4 h-4 mr-1" />
                Add
              </Button>
            </div>
            {filteredTiles.length === 0 && search.trim() ? (
              <div className="flex flex-col items-center justify-center py-20 text-center" data-testid="text-no-results">
                <Search className="w-12 h-12 text-muted-foreground/40 mb-4" />
                <p className="text-lg font-medium text-muted-foreground">No templates found</p>
                <p className="text-sm text-muted-foreground/70 mt-1">Try a different search term</p>
              </div>
            ) : filteredTiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="text-empty-state">
                <FolderOpen className="w-12 h-12 text-muted-foreground/40 mb-4" />
                <p className="text-lg font-medium text-muted-foreground">This folder is empty</p>
                <p className="text-sm text-muted-foreground/70 mt-1 mb-4">
                  Add a template or drag one here from another folder
                </p>
                <Button onClick={addTile} data-testid="button-add-tile-empty">
                  <Plus className="w-4 h-4 mr-1" />
                  Add Template
                </Button>
              </div>
            ) : (
              <div
                className={`${tileContainerClass} pb-20`}
                style={tileContainerStyle}
                data-testid="grid-tiles"
              >
                {filteredTiles.map(renderTile)}
              </div>
            )}
          </>
        ) : null}

        {isOnDashboard && !searchResultsGlobal && uncategorizedTiles.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="text-dashboard-empty">
            <ClipboardPaste className="w-12 h-12 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">Click a folder to view its templates</p>
          </div>
        )}

          </div>

          <div
            className="w-80 lg:w-96 shrink-0 hidden md:block sticky top-[73px] self-start border rounded-lg bg-card overflow-hidden flex flex-col"
            data-testid="panel-preview"
            style={{ height: "calc(100vh - 97px)" }}
          >
              {previewTile ? (
                <>
                  <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
                    <h3 className="text-sm font-semibold truncate flex-1 mr-2" data-testid="preview-title">
                      {previewTile.title || "Untitled"}
                    </h3>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        data-testid="button-preview-copy"
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        onClick={() => copyToClipboard(previewTile)}
                        title="Copy to clipboard"
                      >
                        {copiedId === previewTile.id ? (
                          <Check className="w-4 h-4 text-primary" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        data-testid="button-preview-edit"
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        onClick={() => startEdit(previewTile)}
                        title="Edit template"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        data-testid="button-preview-close"
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        onClick={() => setPreviewTileId(null)}
                        title="Close preview"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {previewTile.folderId && (
                    <div className="px-4 py-2 border-b bg-muted/10">
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <FolderOpen className="w-3 h-3" />
                        {folders.find((f) => f.id === previewTile.folderId)?.name || "Unknown folder"}
                      </span>
                    </div>
                  )}
                  {!previewTile.folderId && folders.length > 0 && (
                    <div className="px-4 py-2 border-b bg-muted/10">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs text-muted-foreground">Move to:</span>
                        {folders.map((f) => (
                          <button
                            key={f.id}
                            data-testid={`preview-move-to-${f.id}`}
                            className="flex items-center gap-1 px-2 py-0.5 rounded border text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
                            onClick={() => {
                              moveTileToFolder(previewTile.id, f.id);
                              setPreviewTileId(null);
                            }}
                          >
                            <FolderOpen className="w-3 h-3" />
                            {f.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="p-4 flex-1 overflow-y-auto">
                    <p
                      className="text-sm text-foreground leading-relaxed whitespace-pre-wrap"
                      data-testid="preview-body"
                    >
                      {previewTile.body || "Empty template"}
                    </p>
                  </div>
                  <div className="px-4 py-3 border-t bg-muted/10">
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => copyToClipboard(previewTile)}
                      data-testid="button-preview-copy-full"
                    >
                      {copiedId === previewTile.id ? (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4 mr-2" />
                          Copy to Clipboard
                        </>
                      )}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center flex-1 px-4 text-center" data-testid="preview-empty">
                  <FileText className="w-10 h-10 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">Select a template to preview</p>
                </div>
              )}
          </div>
        </div>
      </main>

      {draggingTileId && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 animate-in slide-in-from-bottom-full duration-200"
          data-testid="drag-drop-bar"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <p className="text-xs text-muted-foreground mb-2 font-medium">Drop into a folder:</p>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {folders
                .filter((f) => f.id !== openFolderId)
                .map((folder) => {
                  const isDragOver = dragOverFolderId === folder.id;
                  return (
                    <div
                      key={folder.id}
                      data-testid={`drop-target-${folder.id}`}
                      className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-md border-2 border-dashed transition-all cursor-default ${
                        isDragOver
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground"
                      }`}
                      onDragOver={(e) => handleFolderDragOver(e, folder.id)}
                      onDragLeave={handleFolderDragLeave}
                      onDrop={(e) => handleFolderDrop(e, folder.id)}
                    >
                      <FolderOpen className="w-4 h-4" />
                      <span className="text-sm font-medium">{folder.name}</span>
                    </div>
                  );
                })}
              <div
                data-testid="drop-target-uncategorized"
                className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-md border-2 border-dashed transition-all cursor-default ${
                  dragOverFolderId === UNCATEGORIZED_ID
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground"
                }`}
                onDragOver={(e) => handleFolderDragOver(e, UNCATEGORIZED_ID)}
                onDragLeave={handleFolderDragLeave}
                onDrop={(e) => handleFolderDrop(e, null)}
              >
                <Inbox className="w-4 h-4" />
                <span className="text-sm font-medium">Uncategorized</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <Dialog open={editDialogOpen} onOpenChange={(open) => {
        setEditDialogOpen(open);
        if (!open) {
          setEditingTile(null);
          setEditTitle("");
          setEditBody("");
          setEditFolderId(null);
        }
      }}>
        <DialogContent className="sm:max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
          <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b">
            <DialogHeader className="flex-1 min-w-0">
              <DialogTitle data-testid="text-dialog-title">
                {editingTile && tiles.find((t) => t.id === editingTile.id)
                  ? "Edit Template"
                  : "New Template"}
              </DialogTitle>
              <DialogDescription>
                Add a title and paste or type your template text below.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 shrink-0 mt-1">
              <Button
                variant="secondary"
                onClick={() => setEditDialogOpen(false)}
                data-testid="button-cancel-edit"
              >
                Cancel
              </Button>
              <Button onClick={saveEdit} data-testid="button-save-edit">
                Save
              </Button>
            </div>
          </div>

          <div className="flex-1 min-h-0 flex flex-col gap-4 px-6 py-4 overflow-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 shrink-0">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Title</label>
                <Input
                  data-testid="input-edit-title"
                  placeholder="e.g. Follow-up email"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Folder</label>
                <Select
                  value={editFolderId ?? UNCATEGORIZED_ID}
                  onValueChange={(val) =>
                    setEditFolderId(val === UNCATEGORIZED_ID ? null : val)
                  }
                >
                  <SelectTrigger data-testid="select-folder">
                    <SelectValue placeholder="Select folder" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNCATEGORIZED_ID}>Uncategorized</SelectItem>
                    {folders.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between mb-1.5 shrink-0">
                <label className="text-sm font-medium">Template text</label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      setEditBody(text);
                      toast({ title: "Pasted from clipboard", duration: 1500 });
                    } catch {
                      toast({
                        title: "Paste failed",
                        description: "Use Ctrl+V / Cmd+V to paste instead",
                        variant: "destructive",
                        duration: 3000,
                      });
                    }
                  }}
                  data-testid="button-paste-helper"
                >
                  <ClipboardPaste className="w-3.5 h-3.5 mr-1" />
                  Paste
                </Button>
              </div>
              <Textarea
                data-testid="input-edit-body"
                placeholder="Type or paste your template text here..."
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                className="flex-1 min-h-0 resize-none font-mono text-sm"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={folderDialogOpen} onOpenChange={(open) => {
        setFolderDialogOpen(open);
        if (!open) {
          setFolderName("");
          setRenamingFolderId(null);
        }
      }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle data-testid="text-folder-dialog-title">
              {folderDialogMode === "add" ? "New Folder" : "Rename Folder"}
            </DialogTitle>
            <DialogDescription>
              {folderDialogMode === "add"
                ? "Create a new folder to organize your templates."
                : "Enter a new name for this folder."}
            </DialogDescription>
          </DialogHeader>
          <Input
            data-testid="input-folder-name"
            placeholder="e.g. Emails, Finance, HR..."
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && folderName.trim()) saveFolder();
            }}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setFolderDialogOpen(false)}
              data-testid="button-cancel-folder"
            >
              Cancel
            </Button>
            <Button
              onClick={saveFolder}
              disabled={!folderName.trim()}
              data-testid="button-save-folder"
            >
              {folderDialogMode === "add" ? "Create" : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle data-testid="text-import-title">Import Templates</DialogTitle>
            <DialogDescription>
              Paste the JSON export below. This will replace all existing templates.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            data-testid="input-import-json"
            placeholder='{"folders": [...], "tiles": [...]}'
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            className="min-h-[200px] resize-y font-mono text-sm"
          />

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setImportDialogOpen(false);
                setImportText("");
              }}
              data-testid="button-cancel-import"
            >
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={!importText.trim()}
              data-testid="button-confirm-import"
            >
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={passwordDialogOpen} onOpenChange={(open) => {
        setPasswordDialogOpen(open);
        if (!open) {
          setPasswordInput("");
          setPasswordFolderId(null);
        }
      }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {passwordDialogMode === "unlock" ? "🔒 Enter Password" : passwordDialogMode === "set" ? "🔐 Set Password" : "🔓 Remove Password"}
            </DialogTitle>
            <DialogDescription>
              {passwordDialogMode === "unlock"
                ? "This folder is password protected. Enter the password to access it."
                : passwordDialogMode === "set"
                ? "Set a password to protect this folder."
                : "Enter the current password to remove protection."}
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            placeholder={passwordDialogMode === "set" ? "Choose a password..." : "Enter password..."}
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && passwordInput.trim()) handlePasswordSubmit();
            }}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setPasswordDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handlePasswordSubmit}
              disabled={!passwordInput.trim()}
            >
              {passwordDialogMode === "unlock" ? "Unlock" : passwordDialogMode === "set" ? "Set Password" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Feature 1: Fill Placeholders Dialog */}
      <Dialog open={fillDialogOpen} onOpenChange={setFillDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Fill in placeholders</DialogTitle>
            <DialogDescription>
              Replace the bracketed fields before copying to clipboard.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2 max-h-[60vh] overflow-y-auto">
            {fillPlaceholders.map((p, i) => (
              <div key={p.key} className="flex flex-col gap-1">
                <label className="text-sm font-medium text-foreground">[{p.key}]</label>
                <Input
                  placeholder={`Enter ${p.key}...`}
                  value={p.value}
                  onChange={(e) => {
                    setFillPlaceholders(prev =>
                      prev.map((pp, ii) => ii === i ? { ...pp, value: e.target.value } : pp)
                    );
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") completeFill();
                  }}
                  autoFocus={i === 0}
                />
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => {
              // Copy without filling
              doCopy(fillTileBody, fillTileTitle, copiedId || "");
              setFillDialogOpen(false);
            }}>
              Copy as-is
            </Button>
            <Button onClick={completeFill}>
              Fill & Copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adminOpen} onOpenChange={setAdminOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Admin Panel</DialogTitle>
            <DialogDescription>
              Manage your app and data backups.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-4">
            <Button
              variant="secondary"
              className="w-full justify-start gap-3 h-14"
              onClick={() => {
                downloadContentBackup();
                setAdminOpen(false);
              }}
            >
              <Database className="w-5 h-5 text-blue-400" />
              <div className="text-left">
                <div className="font-medium">Download Content Backup</div>
                <div className="text-xs text-muted-foreground">All templates, folders & settings as JSON</div>
              </div>
            </Button>

            <Button
              variant="secondary"
              className="w-full justify-start gap-3 h-14"
              onClick={() => {
                downloadAllCode();
                setAdminOpen(false);
              }}
            >
              <Code className="w-5 h-5 text-green-400" />
              <div className="text-left">
                <div className="font-medium">Download All Code</div>
                <div className="text-xs text-muted-foreground">Full source code from GitHub as ZIP</div>
              </div>
            </Button>

            <Button
              variant="secondary"
              className="w-full justify-start gap-3 h-14"
              onClick={() => setVaultSectionsOpen(true)}
              data-testid="button-vault-sections"
            >
              <Boxes className="w-5 h-5 text-purple-400" />
              <div className="text-left">
                <div className="font-medium">Vault Sections</div>
                <div className="text-xs text-muted-foreground">Create and manage vault categories</div>
              </div>
            </Button>

            <Button
              variant="secondary"
              className="w-full justify-start gap-3 h-14"
              onClick={() => {
                setAdminOpen(false);
                setTrashOpen(true);
              }}
              data-testid="button-open-trash"
            >
              <Trash2 className="w-5 h-5 text-orange-400" />
              <div className="text-left">
                <div className="font-medium">Trash Bin</div>
                <div className="text-xs text-muted-foreground">Restore deleted tiles &amp; folders within 30 days</div>
              </div>
            </Button>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setAdminOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={vaultSectionsOpen} onOpenChange={(open) => { setVaultSectionsOpen(open); if (!open) { setEditingFolderId(null); setNewFolderName(""); setNewFolderIcon(""); setNewFolderColor("#3b82f6"); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Vault Sections</DialogTitle>
            <DialogDescription>
              Create and manage your vault categories
            </DialogDescription>
          </DialogHeader>

          {editingFolderId ? (
            // Edit Mode
            <div className="flex flex-col gap-4 py-4">
              <div>
                <label className="text-sm font-medium">Section Name</label>
                <Input
                  value={editingFolderName}
                  onChange={(e) => setEditingFolderName(e.target.value)}
                  placeholder="e.g., Banking"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Icon</label>
                <Input
                  value={editingFolderIcon}
                  onChange={(e) => setEditingFolderIcon(e.target.value)}
                  placeholder="e.g., 🏦"
                  maxLength={4}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Color</label>
                <div className="flex gap-2 mt-1">
                  <input
                    type="color"
                    value={editingFolderColor}
                    onChange={(e) => setEditingFolderColor(e.target.value)}
                    className="w-12 h-10 rounded border cursor-pointer"
                  />
                  <Input
                    value={editingFolderColor}
                    onChange={(e) => setEditingFolderColor(e.target.value)}
                    placeholder="#3b82f6"
                    className="flex-1"
                  />
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="secondary" onClick={() => setEditingFolderId(null)}>
                  Cancel
                </Button>
                <Button onClick={async () => {
                  if (!editingFolderName.trim()) {
                    toast({ title: "Please enter a section name", variant: "destructive" });
                    return;
                  }
                  await updateFolder(editingFolderId, {
                    name: editingFolderName,
                    icon: editingFolderIcon,
                    color: editingFolderColor,
                  });
                  setEditingFolderId(null);
                }}>
                  Save Changes
                </Button>
              </DialogFooter>
            </div>
          ) : (
            // View Mode
            <div className="flex flex-col gap-4 py-4">
              {/* Add New Section */}
              <div className="border rounded-md p-3 bg-muted/30">
                <h4 className="text-sm font-medium mb-3">Create New Section</h4>
                <div className="flex gap-2">
                  <Input
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Section name"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newFolderName.trim()) {
                        createNewFolder();
                      }
                    }}
                  />
                  <Button onClick={createNewFolder} size="sm" disabled={!newFolderName.trim()}>
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Existing Sections */}
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {folders.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    No sections yet. Create one above!
                  </div>
                ) : (
                  folders.map((folder) => {
                    const count = tiles.filter((t) => t.folderId === folder.id).length;
                    return (
                      <div
                        key={folder.id}
                        className="flex items-center gap-3 p-3 border rounded-md hover:bg-muted/50 group"
                      >
                        <div
                          className="flex-1 flex items-center gap-3 min-w-0"
                        >
                          {folder.icon && <span className="text-2xl shrink-0">{folder.icon}</span>}
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium truncate">{folder.name}</h4>
                            <p className="text-xs text-muted-foreground">{count} items</p>
                          </div>
                          {folder.color && (
                            <div
                              className="w-5 h-5 rounded border shrink-0"
                              style={{ backgroundColor: folder.color }}
                            />
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingFolderId(folder.id);
                              setEditingFolderName(folder.name);
                              setEditingFolderIcon(folder.icon || "");
                              setEditingFolderColor(folder.color || "#3b82f6");
                            }}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (confirm(`Delete "${folder.name}"? This section and its items will be moved to Trash (recoverable for 30 days).`)) {
                                deleteFolder(folder.id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="secondary" onClick={() => {
              setVaultSectionsOpen(false);
              setNewFolderName("");
              setEditingFolderId(null);
            }}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TrashBinDialog
        open={trashOpen}
        onOpenChange={setTrashOpen}
        siteAuthenticated={siteAuthenticated}
        restoringId={restoringTrashId}
        setRestoringId={setRestoringTrashId}
        toast={toast}
        invalidateData={() => queryClient.invalidateQueries({ queryKey: ["/api/data"] })}
      />
    </div>
  );
}

// ── Trash Bin ───────────────────────────────────────────────

const TRASH_RETENTION_DAYS = 30;

interface TrashItem {
  id: string;
  kind: "tile" | "folder";
  originalId: string;
  groupId: string | null;
  payload: unknown;
  deletedAt: string;
}

/** Best-effort label extraction from an unknown trash payload. */
function trashItemLabel(item: TrashItem): string {
  const p = item.payload as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== "object") {
    return item.kind === "tile" ? "(untitled)" : "(untitled folder)";
  }
  if (item.kind === "tile") {
    return typeof p.title === "string" && p.title ? p.title : "(untitled)";
  }
  return typeof p.name === "string" && p.name ? p.name : "(untitled folder)";
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const diffMs = Date.now() - t;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function daysRemaining(iso: string): number {
  const t = new Date(iso).getTime();
  const elapsedDays = (Date.now() - t) / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil(TRASH_RETENTION_DAYS - elapsedDays));
}

interface TrashBinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteAuthenticated: boolean;
  restoringId: string | null;
  setRestoringId: (id: string | null) => void;
  toast: ReturnType<typeof useToast>["toast"];
  invalidateData: () => void;
}

function TrashBinDialog({
  open,
  onOpenChange,
  siteAuthenticated,
  restoringId,
  setRestoringId,
  toast,
  invalidateData,
}: TrashBinDialogProps) {
  const queryClient = useQueryClient();
  const [purgeConfirmId, setPurgeConfirmId] = useState<string | null>(null);
  const [purgingId, setPurgingId] = useState<string | null>(null);

  const { data: items = [], isLoading, error } = useQuery<TrashItem[]>({
    queryKey: ["/api/trash"],
    queryFn: () => apiFetch<TrashItem[]>("/api/trash"),
    enabled: open && siteAuthenticated,
  });

  const handleRestore = async (item: TrashItem) => {
    setRestoringId(item.id);
    try {
      const result = await apiRestoreFromTrash(item.id);
      if (result.ok) {
        toast({
          title: "Restored",
          description: `"${trashItemLabel(item)}" is back.`,
          duration: 1800,
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["/api/trash"] }),
          invalidateData(),
        ]);
      } else {
        toast({
          title: "Restore failed",
          description:
            result.reason === "id_exists"
              ? "An item with this id already exists in the live list. Rename or remove it first."
              : result.reason === "not_found"
                ? "This trash entry no longer exists."
                : `Restore refused: ${result.reason}`,
          variant: "destructive",
          duration: 4500,
        });
      }
    } finally {
      setRestoringId(null);
    }
  };

  const handlePermanentDelete = async (item: TrashItem) => {
    if (purgeConfirmId !== item.id) {
      setPurgeConfirmId(item.id);
      // Auto-clear the confirmation after a few seconds.
      setTimeout(
        () => setPurgeConfirmId((cur) => (cur === item.id ? null : cur)),
        3000,
      );
      return;
    }
    setPurgeConfirmId(null);
    setPurgingId(item.id);
    try {
      await apiPermanentlyDeleteTrash(item.id);
      toast({
        title: "Permanently deleted",
        description: `"${trashItemLabel(item)}" is gone for good.`,
        duration: 1800,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/trash"] });
    } catch (err) {
      toast({
        title: "Permanent delete failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
        duration: 3500,
      });
    } finally {
      setPurgingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b">
          <DialogHeader className="flex-1 min-w-0">
            <DialogTitle data-testid="text-trash-title">Trash Bin</DialogTitle>
            <DialogDescription>
              Items deleted in the app land here for {TRASH_RETENTION_DAYS} days,
              then are permanently purged on the next server boot.
            </DialogDescription>
          </DialogHeader>
          <div className="shrink-0 mt-1">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Loading…
            </div>
          ) : error ? (
            <div className="text-sm text-destructive py-6 text-center">
              Failed to load trash.
            </div>
          ) : items.length === 0 ? (
            <div className="text-sm text-muted-foreground py-10 text-center">
              Trash is empty.
            </div>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="list-trash-items">
              {items.map((item) => {
                const label = trashItemLabel(item);
                const days = daysRemaining(item.deletedAt);
                const isConfirmingPurge = purgeConfirmId === item.id;
                const isBusy =
                  restoringId === item.id || purgingId === item.id;
                return (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 rounded-md border border-border bg-card/40 px-3 py-2"
                    data-testid={`trash-item-${item.id}`}
                  >
                    {item.kind === "folder" ? (
                      <FolderOpen className="w-4 h-4 text-blue-400 shrink-0" />
                    ) : (
                      <FileText className="w-4 h-4 text-zinc-400 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {label}
                        {item.groupId && item.kind === "folder" && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            (with templates)
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {item.kind} · deleted {formatRelative(item.deletedAt)}
                        {" · "}
                        <span
                          className={
                            days <= 3
                              ? "text-orange-400"
                              : "text-muted-foreground"
                          }
                        >
                          {days === 0
                            ? "expires next boot"
                            : `${days}d remaining`}
                        </span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handlePermanentDelete(item)}
                      disabled={isBusy}
                      title={
                        isConfirmingPurge
                          ? "Click again to confirm"
                          : "Permanently delete (cannot be undone)"
                      }
                      data-testid={`button-purge-${item.id}`}
                      className={
                        isConfirmingPurge
                          ? "text-destructive"
                          : "text-muted-foreground hover:text-destructive"
                      }
                    >
                      {purgingId === item.id
                        ? "Deleting…"
                        : isConfirmingPurge
                          ? "Sure?"
                          : "Delete"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleRestore(item)}
                      disabled={isBusy}
                      data-testid={`button-restore-${item.id}`}
                    >
                      {restoringId === item.id ? "Restoring…" : "Restore"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
