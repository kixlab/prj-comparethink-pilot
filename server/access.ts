import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/** Request header carrying the participant access key from the invitation link. */
export const ACCESS_HEADER = "x-pilot-access";
export const ACCESS_ERROR =
  "Access link is missing or invalid. Please open the link provided by the researcher.";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Returns a request check for PILOT_ACCESS_TOKENS (comma or whitespace separated).
 * With no tokens configured every request passes, which keeps local development open.
 */
export function accessGuard(env: Record<string, string | undefined>) {
  const tokens = (env.PILOT_ACCESS_TOKENS ?? "")
    .split(/[\s,]+/)
    .filter(Boolean);
  for (const token of tokens)
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(token))
      throw new Error(
        "Each PILOT_ACCESS_TOKENS entry must be 16–128 letters, numbers, underscores or hyphens",
      );
  const allowed = tokens.map(digest);
  return (req: IncomingMessage) => {
    if (!allowed.length) return true;
    const value = req.headers[ACCESS_HEADER];
    if (typeof value !== "string" || !value) return false;
    const received = digest(value);
    // Compare fixed-length digests in constant time; check every entry.
    return allowed.reduce(
      (match, token) => timingSafeEqual(token, received) || match,
      false,
    );
  };
}
