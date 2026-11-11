// Background upload of locally saved sessions to the server copy (MongoDB + disk).
// IndexedDB stays the primary record; uploads are add-only and safe to repeat.
import { apiFetch } from "./access";
import {
  decodeFrames,
  frameHeader,
  type AudioChunkMeta,
  type ServerSessionSummary,
  type SyncStatus,
} from "./syncFormat";
import {
  audioChunkIds,
  countEvents,
  eventsAfter,
  getAudioChunks,
  getStoredSession,
  listSessions,
  loadTranscriptions,
} from "./storage";
import { errorText } from "./types";
import type { AudioChunk, Session, Snapshot } from "./types";
import type { TranscriptionRecord } from "./transcriptionTypes";

export const ADMIN_ACCESS_ERROR =
  "Server sessions are available only with the researcher's admin link.";

export interface SyncState {
  status: "syncing" | "synced" | "pending" | "error";
  pending: number;
  error?: string;
  synced_at?: string;
}
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
interface Cursor {
  eventSeq: number;
  chunks: Set<string>;
  transcriptions: Set<string>;
  sessionJson: string;
}

const EVENT_BATCH = 500;
const AUDIO_BATCH_BYTES = 4 * 1024 * 1024;
const AUDIO_BATCH_COUNT = 300;
const READ_BATCH = 100;
const INTERVAL_MS = 10_000;

async function ok(response: Response) {
  if (response.ok) return response;
  let message = `HTTP ${response.status}`;
  try {
    const body = await response.json();
    if (body?.error) message = body.error;
  } catch {
    /* non-JSON error body */
  }
  throw new Error(message);
}

export class SyncManager {
  enabled = false;
  current: string | null = null;
  private cursors = new Map<string, Cursor>();
  private states = new Map<string, SyncState>();
  private queued = new Map<string, Promise<SyncState | undefined>>();
  private chain: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | undefined;
  private generation = 0;
  private onOnline = () => {
    if (this.current) void this.sync(this.current);
  };
  constructor(
    private changed: () => void = () => {},
    private fetcher: Fetcher = apiFetch,
  ) {}

  /** Checks whether the server stores sessions; if so uploads this browser's sessions and keeps the current one in sync. */
  async start() {
    const generation = ++this.generation;
    let enabled = false;
    try {
      const response = await this.fetcher("/api/sync/config");
      enabled = response.ok && Boolean((await response.json())?.enabled);
    } catch {
      enabled = false;
    }
    // stop() (or a newer start()) ran while waiting: leave no timer behind.
    if (generation !== this.generation) return false;
    this.enabled = enabled;
    this.changed();
    if (!this.enabled) return false;
    this.timer = setInterval(() => {
      if (this.current) void this.sync(this.current);
    }, INTERVAL_MS);
    if (typeof window !== "undefined")
      window.addEventListener("online", this.onOnline);
    void this.syncAll();
    return true;
  }
  stop() {
    this.generation++;
    clearInterval(this.timer);
    if (typeof window !== "undefined")
      window.removeEventListener("online", this.onOnline);
  }
  state(sessionId: string) {
    return this.states.get(sessionId);
  }
  async syncAll() {
    let sessions: Session[] = [];
    try {
      sessions = await listSessions();
    } catch {
      return;
    }
    for (const session of sessions) await this.sync(session.session_id);
  }
  /** Queues one upload pass for a session. Passes run one at a time. */
  sync(sessionId: string): Promise<SyncState | undefined> {
    const waiting = this.queued.get(sessionId);
    if (waiting) return waiting;
    const run = this.chain.then(() => this.run(sessionId));
    this.queued.set(sessionId, run);
    this.chain = run.catch(() => {});
    return run;
  }
  private set(sessionId: string, state: SyncState) {
    this.states.set(sessionId, state);
    this.changed();
    return state;
  }
  private async post(path: string, body: unknown) {
    await ok(
      await this.fetcher(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }
  private async cursor(sessionId: string) {
    const known = this.cursors.get(sessionId);
    if (known) return known;
    const status: SyncStatus = await (
      await ok(
        await this.fetcher(
          `/api/sync/status?session_id=${encodeURIComponent(sessionId)}`,
        ),
      )
    ).json();
    // Resume after the server's events only if they match what is stored here; otherwise
    // resend everything (the server ignores duplicates).
    let eventSeq = -1;
    if (status.event_count && status.event_max_sequence !== null) {
      const local = await countEvents(sessionId, -1, status.event_max_sequence);
      if (local === status.event_count) eventSeq = status.event_max_sequence;
    }
    const cursor: Cursor = {
      eventSeq,
      chunks: new Set(status.chunk_ids),
      transcriptions: new Set(status.transcription_ids),
      sessionJson: "",
    };
    this.cursors.set(sessionId, cursor);
    return cursor;
  }
  private async pushSession(session: Session, cursor: Cursor) {
    const body = JSON.stringify({ session });
    if (body === cursor.sessionJson) return;
    await ok(
      await this.fetcher("/api/sync/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    );
    cursor.sessionJson = body;
  }
  private async uploadAudio(sessionId: string, chunks: AudioChunk[]) {
    const metas: AudioChunkMeta[] = chunks.map(({ blob, ...meta }) => ({
      ...meta,
      byte_length: blob.size,
    }));
    const body = new Blob([frameHeader(metas), ...chunks.map((c) => c.blob)]);
    await ok(
      await this.fetcher(
        `/api/sync/audio?session_id=${encodeURIComponent(sessionId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body,
        },
      ),
    );
  }
  private async pending(sessionId: string, cursor: Cursor, transcripts = 0) {
    const [events, chunkIds] = await Promise.all([
      countEvents(sessionId, cursor.eventSeq),
      audioChunkIds(sessionId),
    ]);
    return (
      events +
      chunkIds.filter((c) => !cursor.chunks.has(c)).length +
      transcripts
    );
  }
  private async run(sessionId: string) {
    this.queued.delete(sessionId);
    if (!this.enabled) return undefined;
    const prior = this.states.get(sessionId);
    this.set(sessionId, { status: "syncing", pending: prior?.pending ?? 0 });
    let cursor: Cursor | undefined;
    let transcriptsLeft = 0;
    try {
      const session = await getStoredSession(sessionId);
      if (!session)
        return this.set(sessionId, { status: "synced", pending: 0 });
      cursor = await this.cursor(sessionId);
      await this.pushSession(session, cursor);

      for (;;) {
        const events = await eventsAfter(
          sessionId,
          cursor.eventSeq,
          EVENT_BATCH,
        );
        if (!events.length) break;
        await this.post("/api/sync/events", { session_id: sessionId, events });
        cursor.eventSeq = events.at(-1)!.sequence;
      }

      const missing = (await audioChunkIds(sessionId)).filter(
        (c) => !cursor!.chunks.has(c),
      );
      let batch: AudioChunk[] = [];
      let bytes = 0;
      const flush = async () => {
        if (!batch.length) return;
        await this.uploadAudio(sessionId, batch);
        for (const chunk of batch) cursor!.chunks.add(chunk.chunk_id);
        batch = [];
        bytes = 0;
      };
      for (let i = 0; i < missing.length; i += READ_BATCH)
        for (const chunk of await getAudioChunks(
          missing.slice(i, i + READ_BATCH),
        )) {
          if (
            batch.length &&
            (bytes + chunk.blob.size > AUDIO_BATCH_BYTES ||
              batch.length >= AUDIO_BATCH_COUNT)
          )
            await flush();
          batch.push(chunk);
          bytes += chunk.blob.size;
        }
      await flush();

      let records: TranscriptionRecord[] = [];
      try {
        records = await loadTranscriptions(sessionId);
      } catch {
        /* Transcripts are derived data; a read failure must not stop the recording upload. */
      }
      const fresh = records.filter(
        (r) => !cursor!.transcriptions.has(r.entry_id),
      );
      transcriptsLeft = fresh.length;
      for (let i = 0; i < fresh.length; i += READ_BATCH) {
        const part = fresh.slice(i, i + READ_BATCH);
        await this.post("/api/sync/transcriptions", {
          session_id: sessionId,
          records: part,
        });
        for (const r of part) cursor.transcriptions.add(r.entry_id);
        transcriptsLeft -= part.length;
      }

      const latest = await getStoredSession(sessionId);
      if (latest) await this.pushSession(latest, cursor);
      const pending = await this.pending(sessionId, cursor);
      return this.set(sessionId, {
        status: pending ? "pending" : "synced",
        pending,
        synced_at: new Date().toISOString(),
      });
    } catch (e) {
      let pending = prior?.pending ?? 0;
      if (cursor)
        pending = await this.pending(sessionId, cursor, transcriptsLeft).catch(
          () => pending,
        );
      return this.set(sessionId, {
        status: "error",
        pending,
        error: errorText(e),
        synced_at: prior?.synced_at,
      });
    }
  }
}

export async function listServerSessions(
  fetcher: Fetcher = apiFetch,
): Promise<ServerSessionSummary[]> {
  const response = await fetcher("/api/admin/sessions");
  if (response.status === 403) throw new Error(ADMIN_ACCESS_ERROR);
  return (await (await ok(response)).json()).sessions;
}

/** Rebuilds a Snapshot (with audio Blobs) from the server copy for review and ZIP export. */
export async function loadServerSnapshot(
  sessionId: string,
  fetcher: Fetcher = apiFetch,
): Promise<Snapshot> {
  const query = `session_id=${encodeURIComponent(sessionId)}`;
  const response = await fetcher(`/api/admin/session?${query}`);
  if (response.status === 403) throw new Error(ADMIN_ACCESS_ERROR);
  const stored = await (await ok(response)).json();
  const audioResponse = await ok(await fetcher(`/api/admin/audio?${query}`));
  const frames = decodeFrames(
    new Uint8Array(await audioResponse.arrayBuffer()),
  );
  const audio: AudioChunk[] = frames.map(({ meta, bytes }) => {
    const { byte_length: _length, sha256: _hash, ...chunk } = meta;
    return {
      ...chunk,
      blob: new Blob([bytes.slice()], { type: meta.mime_type }),
    };
  });
  return {
    session: stored.session,
    events: stored.events,
    audio,
    transcriptions: stored.transcriptions,
    unsaved_transcription_ids: [],
  };
}
