import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MongoClient, type Db } from "mongodb";
import type { RawEvent, Session } from "../src/pilot/types";
import type { TranscriptionRecord } from "../src/pilot/transcriptionTypes";
import type {
  AudioChunkMeta,
  ServerSessionSummary,
  SyncStatus,
} from "../src/pilot/syncFormat";

/**
 * Server copy of browser-collected sessions. Events, audio chunks and transcription
 * records are add-only (duplicates are ignored); the session document only moves forward.
 */
export interface SyncStore {
  putSession(session: Session): Promise<"stored" | "stale">;
  addEvents(sessionId: string, events: RawEvent[]): Promise<number>;
  addAudio(
    sessionId: string,
    chunks: { meta: AudioChunkMeta; bytes: Uint8Array }[],
  ): Promise<number>;
  addTranscriptions(
    sessionId: string,
    records: TranscriptionRecord[],
  ): Promise<number>;
  status(sessionId: string): Promise<SyncStatus>;
  listSessions(): Promise<ServerSessionSummary[]>;
  loadSession(sessionId: string): Promise<{
    session: Session;
    events: RawEvent[];
    transcriptions: TranscriptionRecord[];
    audio: AudioChunkMeta[];
  } | null>;
  readAudio(meta: AudioChunkMeta): Promise<Uint8Array>;
  close(): Promise<void>;
}

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const byChunkOrder = (a: AudioChunkMeta, b: AudioChunkMeta) =>
  a.segment_id === b.segment_id
    ? a.index - b.index
    : a.received_t_ms - b.received_t_ms;
function summary(
  session: Session,
  counts: { events: number; chunks: number; bytes: number },
  syncedAt?: Date,
): ServerSessionSummary {
  return {
    session_id: session.session_id,
    participant_id: session.participant_id,
    ui_language: session.ui_language,
    task_title: session.config.task.title,
    task_language: session.config.task.language,
    origin_utc: session.clock.origin_utc,
    status: session.status,
    collection_status: session.collection_status,
    synced_at: syncedAt?.toISOString(),
    event_count: counts.events,
    audio_chunk_count: counts.chunks,
    audio_bytes: counts.bytes,
  };
}
/** Drops server bookkeeping fields (_id, _synced_at) before returning documents. */
function clean<T>(doc: T): T {
  const out = { ...doc } as Record<string, unknown>;
  for (const key of Object.keys(out)) if (key.startsWith("_")) delete out[key];
  return out as T;
}
const isDuplicate = (error: unknown) =>
  (error as { code?: number })?.code === 11000;

export class MongoSyncStore implements SyncStore {
  private client: MongoClient;
  private ready?: Promise<Db>;
  constructor(
    private uri: string,
    private dbName: string,
    private dataDir: string,
  ) {
    this.client = this.newClient();
  }
  private newClient() {
    return new MongoClient(this.uri, { serverSelectionTimeoutMS: 10_000 });
  }
  private db() {
    this.ready ??= (async () => {
      const db = this.client.db(this.dbName);
      await Promise.all([
        db
          .collection("sessions")
          .createIndex({ session_id: 1 }, { unique: true }),
        db
          .collection("events")
          .createIndex({ session_id: 1, sequence: 1 }, { unique: true }),
        db
          .collection("audio_chunks")
          .createIndex({ chunk_id: 1 }, { unique: true }),
        db.collection("audio_chunks").createIndex({ session_id: 1 }),
        db
          .collection("transcriptions")
          .createIndex({ entry_id: 1 }, { unique: true }),
        db.collection("transcriptions").createIndex({ session_id: 1 }),
      ]);
      return db;
    })().catch((error) => {
      // A client whose first connection failed stays closed ("Topology is closed"),
      // so start the next request with a fresh one.
      this.ready = undefined;
      const failed = this.client;
      this.client = this.newClient();
      void failed.close().catch(() => {});
      throw error;
    });
    return this.ready;
  }
  private audioPath(sessionId: string, chunkId: string) {
    return join(this.dataDir, "audio", sessionId, `${chunkId}.bin`);
  }
  async putSession(session: Session) {
    const db = await this.db();
    try {
      await db.collection("sessions").replaceOne(
        {
          session_id: session.session_id,
          last_sequence: { $lte: session.last_sequence },
        },
        { ...session, _synced_at: new Date() },
        { upsert: true },
      );
      return "stored" as const;
    } catch (error) {
      // A newer snapshot is already stored: the filter missed and the upsert hit the unique index.
      if (isDuplicate(error)) return "stale" as const;
      throw error;
    }
  }
  private async insertMany(collection: string, docs: object[]) {
    if (!docs.length) return 0;
    const db = await this.db();
    try {
      const result = await db.collection(collection).insertMany(
        docs.map((d) => ({ ...d })),
        { ordered: false },
      );
      return result.insertedCount;
    } catch (error) {
      const bulk = error as {
        writeErrors?: { code: number }[] | { code: number };
        insertedCount?: number;
        result?: { insertedCount?: number };
      };
      const errors = Array.isArray(bulk.writeErrors)
        ? bulk.writeErrors
        : bulk.writeErrors
          ? [bulk.writeErrors]
          : [];
      if (errors.length && errors.every((e) => e.code === 11000))
        return bulk.insertedCount ?? bulk.result?.insertedCount ?? 0;
      throw error;
    }
  }
  addEvents(_sessionId: string, events: RawEvent[]) {
    return this.insertMany("events", events);
  }
  addTranscriptions(_sessionId: string, records: TranscriptionRecord[]) {
    return this.insertMany("transcriptions", records);
  }
  async addAudio(
    sessionId: string,
    chunks: { meta: AudioChunkMeta; bytes: Uint8Array }[],
  ) {
    const db = await this.db();
    let added = 0;
    for (const { meta, bytes } of chunks) {
      const path = this.audioPath(sessionId, meta.chunk_id);
      const exists = await stat(path).then(
        (s) => s.size === bytes.byteLength,
        () => false,
      );
      if (!exists) {
        await mkdir(join(this.dataDir, "audio", sessionId), {
          recursive: true,
        });
        const temporary = `${path}.${process.pid}.tmp`;
        await writeFile(temporary, bytes);
        await rename(temporary, path);
      }
      try {
        await db.collection("audio_chunks").insertOne({
          ...meta,
          byte_length: bytes.byteLength,
          sha256: sha256(bytes),
          _stored_at: new Date(),
        });
        added++;
      } catch (error) {
        if (!isDuplicate(error)) throw error;
      }
    }
    return added;
  }
  async status(sessionId: string): Promise<SyncStatus> {
    const db = await this.db();
    const [session, eventCount, lastEvent, chunkIds, transcriptionIds] =
      await Promise.all([
        db
          .collection("sessions")
          .findOne(
            { session_id: sessionId },
            { projection: { last_sequence: 1 } },
          ),
        db.collection("events").countDocuments({ session_id: sessionId }),
        db
          .collection("events")
          .find({ session_id: sessionId }, { projection: { sequence: 1 } })
          .sort({ sequence: -1 })
          .limit(1)
          .next(),
        db
          .collection("audio_chunks")
          .distinct("chunk_id", { session_id: sessionId }),
        db
          .collection("transcriptions")
          .distinct("entry_id", { session_id: sessionId }),
      ]);
    return {
      exists: Boolean(session),
      last_sequence: (session?.last_sequence as number | undefined) ?? null,
      event_count: eventCount,
      event_max_sequence: (lastEvent?.sequence as number | undefined) ?? null,
      chunk_ids: chunkIds as string[],
      transcription_ids: transcriptionIds as string[],
    };
  }
  async listSessions() {
    const db = await this.db();
    const [sessions, events, audio] = await Promise.all([
      db
        .collection("sessions")
        .find({})
        .sort({ "clock.origin_utc": -1 })
        .limit(1000)
        .toArray(),
      db
        .collection("events")
        .aggregate([{ $group: { _id: "$session_id", n: { $sum: 1 } } }])
        .toArray(),
      db
        .collection("audio_chunks")
        .aggregate([
          {
            $group: {
              _id: "$session_id",
              n: { $sum: 1 },
              bytes: { $sum: "$byte_length" },
            },
          },
        ])
        .toArray(),
    ]);
    const eventCounts = new Map(events.map((e) => [e._id, e.n as number]));
    const audioCounts = new Map(audio.map((a) => [a._id, a]));
    return sessions.map((doc) =>
      summary(
        doc as unknown as Session,
        {
          events: eventCounts.get(doc.session_id) ?? 0,
          chunks: (audioCounts.get(doc.session_id)?.n as number) ?? 0,
          bytes: (audioCounts.get(doc.session_id)?.bytes as number) ?? 0,
        },
        doc._synced_at as Date | undefined,
      ),
    );
  }
  async loadSession(sessionId: string) {
    const db = await this.db();
    const session = await db
      .collection("sessions")
      .findOne({ session_id: sessionId });
    if (!session) return null;
    const [events, transcriptions, audio] = await Promise.all([
      db
        .collection("events")
        .find({ session_id: sessionId })
        .sort({ sequence: 1 })
        .toArray(),
      db
        .collection("transcriptions")
        .find({ session_id: sessionId })
        .sort({ created_at_utc: 1 })
        .toArray(),
      db.collection("audio_chunks").find({ session_id: sessionId }).toArray(),
    ]);
    return {
      session: clean(session) as unknown as Session,
      events: events.map(clean) as unknown as RawEvent[],
      transcriptions: transcriptions.map(
        clean,
      ) as unknown as TranscriptionRecord[],
      audio: (audio.map(clean) as unknown as AudioChunkMeta[]).sort(
        byChunkOrder,
      ),
    };
  }
  async readAudio(meta: AudioChunkMeta) {
    return new Uint8Array(
      await readFile(this.audioPath(meta.session_id, meta.chunk_id)),
    );
  }
  close() {
    return this.client.close();
  }
}

/** Same semantics as MongoSyncStore, kept in memory. Used by automated tests. */
export class MemorySyncStore implements SyncStore {
  sessions = new Map<string, Session>();
  events = new Map<string, RawEvent>();
  audio = new Map<string, { meta: AudioChunkMeta; bytes: Uint8Array }>();
  transcriptions = new Map<string, TranscriptionRecord>();
  async putSession(session: Session) {
    const prior = this.sessions.get(session.session_id);
    if (prior && prior.last_sequence > session.last_sequence)
      return "stale" as const;
    this.sessions.set(session.session_id, structuredClone(session));
    return "stored" as const;
  }
  async addEvents(_sessionId: string, events: RawEvent[]) {
    let added = 0;
    for (const event of events) {
      const key = `${event.session_id}:${event.sequence}`;
      if (this.events.has(key)) continue;
      this.events.set(key, structuredClone(event));
      added++;
    }
    return added;
  }
  async addAudio(
    _sessionId: string,
    chunks: { meta: AudioChunkMeta; bytes: Uint8Array }[],
  ) {
    let added = 0;
    for (const { meta, bytes } of chunks) {
      if (this.audio.has(meta.chunk_id)) continue;
      this.audio.set(meta.chunk_id, {
        meta: { ...meta, byte_length: bytes.byteLength, sha256: sha256(bytes) },
        bytes: bytes.slice(),
      });
      added++;
    }
    return added;
  }
  async addTranscriptions(_sessionId: string, records: TranscriptionRecord[]) {
    let added = 0;
    for (const record of records) {
      if (this.transcriptions.has(record.entry_id)) continue;
      this.transcriptions.set(record.entry_id, structuredClone(record));
      added++;
    }
    return added;
  }
  private eventsOf(sessionId: string) {
    return [...this.events.values()]
      .filter((e) => e.session_id === sessionId)
      .sort((a, b) => a.sequence - b.sequence);
  }
  private audioOf(sessionId: string) {
    return [...this.audio.values()]
      .filter((a) => a.meta.session_id === sessionId)
      .map((a) => a.meta)
      .sort(byChunkOrder);
  }
  async status(sessionId: string): Promise<SyncStatus> {
    const events = this.eventsOf(sessionId);
    return {
      exists: this.sessions.has(sessionId),
      last_sequence: this.sessions.get(sessionId)?.last_sequence ?? null,
      event_count: events.length,
      event_max_sequence: events.at(-1)?.sequence ?? null,
      chunk_ids: this.audioOf(sessionId).map((a) => a.chunk_id),
      transcription_ids: [...this.transcriptions.values()]
        .filter((r) => r.session_id === sessionId)
        .map((r) => r.entry_id),
    };
  }
  async listSessions() {
    return [...this.sessions.values()]
      .sort((a, b) => b.clock.origin_utc.localeCompare(a.clock.origin_utc))
      .map((session) => {
        const audio = this.audioOf(session.session_id);
        return summary(session, {
          events: this.eventsOf(session.session_id).length,
          chunks: audio.length,
          bytes: audio.reduce((n, a) => n + a.byte_length, 0),
        });
      });
  }
  async loadSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return {
      session: structuredClone(session),
      events: this.eventsOf(sessionId),
      transcriptions: [...this.transcriptions.values()]
        .filter((r) => r.session_id === sessionId)
        .sort((a, b) => a.created_at_utc.localeCompare(b.created_at_utc)),
      audio: this.audioOf(sessionId),
    };
  }
  async readAudio(meta: AudioChunkMeta) {
    const stored = this.audio.get(meta.chunk_id);
    if (!stored) throw new Error(`Missing audio chunk ${meta.chunk_id}`);
    return stored.bytes;
  }
  async close() {}
}
