import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { ACCESS_ERROR, ADMIN_ERROR, accessGuard, adminGuard } from "./access";
import { MongoSyncStore, type SyncStore } from "./syncStore";
import {
  decodeFrames,
  encodeFrames,
  type AudioChunkMeta,
} from "../src/pilot/syncFormat";
import type { RawEvent, Session } from "../src/pilot/types";
import type { TranscriptionRecord } from "../src/pilot/transcriptionTypes";

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const JSON_LIMIT = 8 * 1024 * 1024;
const AUDIO_LIMIT = 32 * 1024 * 1024;
const MAX_BATCH = 1000;

class RequestError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RequestError(message);
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

async function readRaw(req: IncomingMessage, limit: number) {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += part.byteLength;
    if (size > limit) throw new RequestError("Request too large", 413);
    parts.push(part);
  }
  return new Uint8Array(Buffer.concat(parts));
}
async function readJson(req: IncomingMessage) {
  const text = Buffer.from(await readRaw(req, JSON_LIMIT)).toString("utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestError("Invalid JSON body");
  }
}
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function validSession(value: unknown): Session {
  check(isObject(value), "Missing session");
  const s = value as unknown as Session;
  check(
    typeof s.session_id === "string" && ID.test(s.session_id),
    "Invalid session_id",
  );
  check(typeof s.schema_version === "string", "Invalid schema_version");
  check(Number.isInteger(s.last_sequence), "Invalid last_sequence");
  check(typeof s.clock?.origin_utc === "string", "Invalid clock");
  check(typeof s.config?.task?.title === "string", "Invalid configuration");
  return s;
}
function validEvents(sessionId: string, value: unknown): RawEvent[] {
  check(
    Array.isArray(value) && value.length <= MAX_BATCH,
    "Invalid events batch",
  );
  for (const e of value as RawEvent[])
    check(
      isObject(e) &&
        e.session_id === sessionId &&
        Number.isInteger(e.sequence) &&
        e.sequence >= 0 &&
        typeof e.event_id === "string" &&
        typeof e.type === "string" &&
        Number.isFinite(e.t_ms) &&
        isObject(e.payload),
      "Invalid event",
    );
  return value as RawEvent[];
}
function validTranscriptions(
  sessionId: string,
  value: unknown,
): TranscriptionRecord[] {
  check(
    Array.isArray(value) && value.length <= MAX_BATCH,
    "Invalid transcription batch",
  );
  for (const r of value as TranscriptionRecord[])
    check(
      isObject(r) &&
        r.session_id === sessionId &&
        typeof r.entry_id === "string" &&
        ID.test(r.entry_id),
      "Invalid transcription record",
    );
  return value as TranscriptionRecord[];
}
function validAudio(sessionId: string, meta: AudioChunkMeta) {
  check(
    isObject(meta) &&
      meta.session_id === sessionId &&
      typeof meta.chunk_id === "string" &&
      ID.test(meta.chunk_id) &&
      typeof meta.segment_id === "string" &&
      ID.test(meta.segment_id) &&
      Number.isInteger(meta.index) &&
      meta.index >= 0 &&
      typeof meta.mime_type === "string" &&
      meta.mime_type.length <= 200,
    "Invalid audio chunk metadata",
  );
}

export function createSyncStore(
  env: Record<string, string | undefined>,
  root: string,
): SyncStore | null {
  const uri = env.MONGODB_URI?.trim();
  if (!uri) return null;
  return new MongoSyncStore(
    uri,
    env.MONGODB_DB?.trim() || "comparethink",
    resolve(root, env.PILOT_DATA_DIR?.trim() || "data"),
  );
}

/**
 * /api/sync/* receives browser-collected sessions (add-only); /api/admin/* lets a researcher
 * with an admin key list and download them. Disabled when no store is configured.
 */
export function syncPlugin(
  env: Record<string, string | undefined>,
  root: string,
  injected?: SyncStore | null,
): Plugin {
  const store = injected === undefined ? createSyncStore(env, root) : injected;
  const hasAccess = accessGuard(env);
  const isAdmin = adminGuard(env);
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const sessionId = url.searchParams.get("session_id") ?? "";
    if (path === "/api/sync/config") {
      check(req.method === "GET", "GET only");
      return json(res, 200, { enabled: Boolean(store) });
    }
    if (!store) throw new RequestError("Server storage is not configured", 503);
    if (path.startsWith("/api/admin/")) {
      if (!isAdmin(req)) throw new RequestError(ADMIN_ERROR, 403);
      check(req.method === "GET", "GET only");
      if (path === "/api/admin/sessions")
        return json(res, 200, { sessions: await store.listSessions() });
      check(ID.test(sessionId), "Invalid session_id");
      const stored = await store.loadSession(sessionId);
      if (!stored) throw new RequestError("Session not found", 404);
      if (path === "/api/admin/session") return json(res, 200, stored);
      if (path === "/api/admin/audio") {
        const items = [];
        for (const meta of stored.audio)
          items.push({ meta, bytes: await store.readAudio(meta) });
        const body = encodeFrames(items);
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": body.byteLength,
          "Cache-Control": "no-store",
        });
        return res.end(
          Buffer.from(body.buffer, body.byteOffset, body.byteLength),
        );
      }
      throw new RequestError("Not found", 404);
    }
    if (path === "/api/sync/status") {
      check(req.method === "GET", "GET only");
      check(ID.test(sessionId), "Invalid session_id");
      return json(res, 200, await store.status(sessionId));
    }
    check(req.method === "POST", "POST only");
    if (path === "/api/sync/session") {
      const body = await readJson(req);
      check(isObject(body), "Invalid body");
      const result = await store.putSession(validSession(body.session));
      return json(res, 200, { result });
    }
    if (path === "/api/sync/events") {
      const body = await readJson(req);
      check(
        isObject(body) && typeof body.session_id === "string",
        "Invalid body",
      );
      check(ID.test(body.session_id), "Invalid session_id");
      const added = await store.addEvents(
        body.session_id,
        validEvents(body.session_id, body.events),
      );
      return json(res, 200, { added });
    }
    if (path === "/api/sync/transcriptions") {
      const body = await readJson(req);
      check(
        isObject(body) && typeof body.session_id === "string",
        "Invalid body",
      );
      check(ID.test(body.session_id), "Invalid session_id");
      const added = await store.addTranscriptions(
        body.session_id,
        validTranscriptions(body.session_id, body.records),
      );
      return json(res, 200, { added });
    }
    if (path === "/api/sync/audio") {
      check(ID.test(sessionId), "Invalid session_id");
      let items;
      try {
        items = decodeFrames(await readRaw(req, AUDIO_LIMIT));
      } catch (error) {
        if (error instanceof RequestError) throw error;
        throw new RequestError(
          error instanceof Error ? error.message : "Invalid audio body",
        );
      }
      check(items.length <= MAX_BATCH, "Too many audio chunks");
      for (const { meta } of items) validAudio(sessionId, meta);
      const added = await store.addAudio(sessionId, items);
      return json(res, 200, { added });
    }
    throw new RequestError("Not found", 404);
  }
  const install = (server: {
    middlewares: { use: (handler: any) => void };
  }) => {
    server.middlewares.use(
      async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const path = req.url?.split("?")[0] ?? "";
        if (!path.startsWith("/api/sync/") && !path.startsWith("/api/admin/"))
          return next();
        if (
          req.headers.origin &&
          req.headers.origin !==
            (env.PILOT_PUBLIC_ORIGIN ||
              `${(req.socket as any).encrypted ? "https" : "http"}://${req.headers.host}`)
        )
          return json(res, 403, {
            error: "Cross-origin requests are disabled",
          });
        if (!hasAccess(req)) return json(res, 401, { error: ACCESS_ERROR });
        try {
          await handle(req, res);
        } catch (error) {
          const status = error instanceof RequestError ? error.status : 500;
          if (status === 500) console.error("[sync]", error);
          if (!res.headersSent)
            json(res, status, {
              error:
                status === 500
                  ? `Server storage error: ${error instanceof Error ? error.message : String(error)}`
                  : (error as Error).message,
            });
        }
      },
    );
  };
  return {
    name: "comparethink-sync",
    configureServer: install,
    configurePreviewServer: install,
  };
}
