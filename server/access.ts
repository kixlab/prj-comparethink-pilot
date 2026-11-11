import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/** Request header carrying the access key from the invitation link. */
export const ACCESS_HEADER = "x-pilot-access";
export const ACCESS_ERROR =
  "Access link is missing or invalid. Please open the link provided by the researcher.";
export const ADMIN_ERROR =
  "Admin access requires a key from PILOT_ADMIN_TOKENS.";

const digest = (value: string) => createHash("sha256").update(value).digest();

function tokens(env: Record<string, string | undefined>, name: string) {
  const list = (env[name] ?? "").split(/[\s,]+/).filter(Boolean);
  for (const token of list)
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(token))
      throw new Error(
        `Each ${name} entry must be 16–128 letters, numbers, underscores or hyphens`,
      );
  return list.map(digest);
}

function matches(req: IncomingMessage, allowed: Buffer[]) {
  const value = req.headers[ACCESS_HEADER];
  if (typeof value !== "string" || !value) return false;
  const received = digest(value);
  // Compare fixed-length digests in constant time; check every entry.
  return allowed.reduce(
    (match, token) => timingSafeEqual(token, received) || match,
    false,
  );
}

/**
 * Participant/researcher check for the app API. Accepts PILOT_ACCESS_TOKENS and
 * PILOT_ADMIN_TOKENS. With neither configured every request passes (local development).
 */
export function accessGuard(env: Record<string, string | undefined>) {
  const allowed = [
    ...tokens(env, "PILOT_ACCESS_TOKENS"),
    ...tokens(env, "PILOT_ADMIN_TOKENS"),
  ];
  return (req: IncomingMessage) => !allowed.length || matches(req, allowed);
}

/**
 * Researcher-only check for server-stored sessions. Requires a PILOT_ADMIN_TOKENS key;
 * open only when no tokens of either kind are configured (local development).
 */
export function adminGuard(env: Record<string, string | undefined>) {
  const admin = tokens(env, "PILOT_ADMIN_TOKENS");
  const open = !admin.length && !tokens(env, "PILOT_ACCESS_TOKENS").length;
  return (req: IncomingMessage) => open || matches(req, admin);
}
