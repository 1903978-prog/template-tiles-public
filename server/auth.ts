import { type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";

const API_TOKEN = process.env.API_TOKEN;

// Fail-closed WITHOUT crashing the process. Previously a missing
// API_TOKEN outside development threw at module load, which propagated
// to the startup catch and called process.exit(1) — an opaque 503
// crash-loop on the host with no working page and noisy restart logs.
//
// New behaviour: the server still boots and serves the static app, but
// every /api/* route is hard-denied with 503 until API_TOKEN is set.
// Security is unchanged (API stays locked); availability and
// diagnosability are strictly better (the site loads, the error is
// legible) instead of the whole domain 503-ing.
const IS_DEV = process.env.NODE_ENV === "development";
const AUTH_MISCONFIGURED = !API_TOKEN && !IS_DEV;

if (AUTH_MISCONFIGURED) {
  console.error(
    "[auth] ❌ API_TOKEN is not set and NODE_ENV is not 'development'. " +
      "ALL /api/* routes will return 503 until API_TOKEN is configured. " +
      "Set API_TOKEN in the host environment to restore the API.",
  );
} else if (!API_TOKEN) {
  console.warn(
    "[auth] ⚠️  API_TOKEN is not set. ALL API routes are UNPROTECTED. " +
      "Allowed only because NODE_ENV=development.",
  );
}

/**
 * Timing-safe token comparison to prevent timing attacks.
 */
function tokensMatch(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(provided),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}

/**
 * Express middleware that checks for a valid Bearer token.
 * If API_TOKEN env var is not set, all requests are allowed (with a warning).
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Fail closed: API is locked but the process stays up.
  if (AUTH_MISCONFIGURED) {
    res.status(503).json({
      message:
        "Server auth not configured (API_TOKEN missing). API is locked.",
    });
    return;
  }
  // Dev-only open mode when explicitly NODE_ENV=development.
  if (!API_TOKEN) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const token = authHeader.slice(7);
  if (!tokensMatch(token, API_TOKEN)) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  next();
}

/**
 * Verify endpoint handler — client sends token, server confirms valid/invalid.
 */
export function verifyToken(req: Request, res: Response): void {
  if (AUTH_MISCONFIGURED) {
    res.status(503).json({
      message:
        "Server auth not configured (API_TOKEN missing). API is locked.",
    });
    return;
  }
  if (!API_TOKEN) {
    // Dev-only: no token configured — treat as open access
    res.json({ ok: true });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const token = authHeader.slice(7);
  if (!tokensMatch(token, API_TOKEN)) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  res.json({ ok: true });
}
