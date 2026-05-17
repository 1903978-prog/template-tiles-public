import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { ensureTables, initializeDefaultFolders } from "./db";
import { seedDefaults } from "./seed";
import { storage } from "./storage";

const app = express();
const httpServer = createServer(app);

// Body cap for /api/data (Import). Tiles can hold long email bodies, so
// 5 MB gives plenty of headroom while preventing accidental gigabyte
// pastes. Per-field caps are enforced by zod in server/routes.ts.
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false, limit: "5mb" }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    // DB init steps are individually non-fatal. A failing migration,
    // seed, or default-folder insert must NOT crash the process —
    // that produced an opaque multi-week 503 crash-loop. Instead we
    // log [FATAL-NONBLOCKING] and keep booting so the HTTP server comes
    // up, the static app serves, and the real error is visible in logs
    // (and via API 500s) rather than total downtime.
    console.log("[startup] Step 1: ensureTables...");
    try {
      await ensureTables();
    } catch (err) {
      console.error(
        "[FATAL-NONBLOCKING] ensureTables failed (continuing boot):",
        err,
      );
    }

    console.log("[startup] Step 1b: initializeDefaultFolders...");
    try {
      await initializeDefaultFolders();
    } catch (err) {
      console.error(
        "[FATAL-NONBLOCKING] initializeDefaultFolders failed (continuing boot):",
        err,
      );
    }

    console.log("[startup] Step 2: seedDefaults...");
    try {
      await seedDefaults();
    } catch (err) {
      console.error(
        "[FATAL-NONBLOCKING] seedDefaults failed (continuing boot):",
        err,
      );
    }

    console.log("[startup] Step 2b: purgeExpiredTrash...");
    try {
      const purged = await storage.purgeExpiredTrash();
      if (purged > 0) {
        console.log(`[trash] Purged ${purged} item(s) older than 30 days.`);
      } else {
        console.log("[trash] No expired items to purge.");
      }
    } catch (err) {
      // Trash purge is non-fatal — the app should still boot if it fails.
      console.error("[trash] Purge failed (continuing boot):", err);
    }

    console.log("[startup] Step 3: registerRoutes...");
    await registerRoutes(httpServer, app);

    app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      console.error("Internal Server Error:", err);

      if (res.headersSent) {
        return next(err);
      }

      return res.status(status).json({ message });
    });

    console.log("[startup] Step 4: static files...");
    if (process.env.NODE_ENV === "production") {
      serveStatic(app);
    } else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    }

    console.log("[startup] Step 5: listen...");
    const port = parseInt(process.env.PORT || "5000", 10);
    httpServer.listen(
      {
        port,
        host: "0.0.0.0",
      },
      () => {
        log(`serving on port ${port}`);
      },
    );
  } catch (err) {
    console.error("[FATAL] Server failed to start:", err);
    process.exit(1);
  }
})();
