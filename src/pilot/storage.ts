import type { AudioChunk, RawEvent, Session, Snapshot } from "./types";
import type { TranscriptionRecord } from "./transcriptionTypes";
let opening: Promise<IDBDatabase> | undefined;
export function openDatabase(): Promise<IDBDatabase> {
  if (!opening)
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open("comparethink-pilot-v1", 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("sessions"))
          db.createObjectStore("sessions", { keyPath: "session_id" });
        if (!db.objectStoreNames.contains("events"))
          db.createObjectStore("events", {
            keyPath: ["session_id", "sequence"],
          });
        if (!db.objectStoreNames.contains("audio")) {
          const audio = db.createObjectStore("audio", { keyPath: "chunk_id" });
          audio.createIndex("session_id", "session_id");
        }
        if (!db.objectStoreNames.contains("transcriptions")) {
          const transcripts = db.createObjectStore("transcriptions", {
            keyPath: "entry_id",
          });
          transcripts.createIndex("session_id", "session_id");
        }
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => {
          req.result.close();
          opening = undefined;
        };
        resolve(req.result);
      };
      req.onerror = () => {
        opening = undefined;
        reject(req.error);
      };
      req.onblocked = () => {
        opening = undefined;
        reject(
          new Error(
            "Another tab is blocking the storage update. Close other session tabs and try again.",
          ),
        );
      };
    });
  return opening;
}
function result<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function listSessions() {
  const db = await openDatabase();
  const sessions = await result<Session[]>(
    db.transaction("sessions").objectStore("sessions").getAll(),
  );
  return sessions.sort((a, b) =>
    b.clock.origin_utc.localeCompare(a.clock.origin_utc),
  );
}
export async function loadSnapshot(sessionId: string): Promise<Snapshot> {
  const db = await openDatabase();
  const tx = db.transaction(["sessions", "events", "audio"]);
  const [session, events, audio] = await Promise.all([
    result<Session>(tx.objectStore("sessions").get(sessionId)),
    result<RawEvent[]>(
      tx
        .objectStore("events")
        .getAll(
          IDBKeyRange.bound(
            [sessionId, 0],
            [sessionId, Number.MAX_SAFE_INTEGER],
          ),
        ),
    ),
    result<AudioChunk[]>(
      tx.objectStore("audio").index("session_id").getAll(sessionId),
    ),
  ]);
  if (!session) throw new Error("Session not found.");
  let transcriptions: TranscriptionRecord[] = [];
  try {
    transcriptions = await loadTranscriptions(sessionId);
  } catch {
    /* Derived STT storage must never block export of the original recording. */
  }
  return {
    session,
    events,
    audio,
    transcriptions,
    unsaved_transcription_ids: unsavedTranscriptionIds(sessionId),
    transcription_read_error: transcriptionReadError(sessionId),
  };
}

// Incremental reads for the server uploader. They only see records already persisted here.
export async function getStoredSession(sessionId: string) {
  const db = await openDatabase();
  return result<Session | undefined>(
    db.transaction("sessions").objectStore("sessions").get(sessionId),
  );
}
const eventRange = (sessionId: string, after: number, through: number) =>
  IDBKeyRange.bound([sessionId, after], [sessionId, through], true, false);
export async function eventsAfter(
  sessionId: string,
  after: number,
  limit: number,
) {
  const db = await openDatabase();
  return result<RawEvent[]>(
    db
      .transaction("events")
      .objectStore("events")
      .getAll(eventRange(sessionId, after, Number.MAX_SAFE_INTEGER), limit),
  );
}
export async function countEvents(
  sessionId: string,
  after = -1,
  through = Number.MAX_SAFE_INTEGER,
) {
  const db = await openDatabase();
  return result<number>(
    db
      .transaction("events")
      .objectStore("events")
      .count(eventRange(sessionId, after, through)),
  );
}
export async function audioChunkIds(sessionId: string) {
  const db = await openDatabase();
  return (await result<IDBValidKey[]>(
    db
      .transaction("audio")
      .objectStore("audio")
      .index("session_id")
      .getAllKeys(sessionId),
  )) as string[];
}
export async function getAudioChunks(chunkIds: string[]) {
  const db = await openDatabase();
  const store = db.transaction("audio").objectStore("audio");
  const chunks = await Promise.all(
    chunkIds.map((chunkId) =>
      result<AudioChunk | undefined>(store.get(chunkId)),
    ),
  );
  return chunks.filter((c): c is AudioChunk => Boolean(c));
}

const transcriptionMemory = new Map<string, TranscriptionRecord>();
const transcriptionPending = new Set<string>();
const transcriptionReadErrors = new Map<string, string>();
export function transcriptionReadError(sessionId: string) {
  return transcriptionReadErrors.get(sessionId);
}
export function unsavedTranscriptionIds(sessionId: string) {
  return [...transcriptionPending].filter(
    (id) => transcriptionMemory.get(id)?.session_id === sessionId,
  );
}
export async function loadTranscriptions(sessionId: string) {
  const cached = () =>
    [...transcriptionMemory.values()].filter((r) => r.session_id === sessionId);
  try {
    const db = await openDatabase();
    const records = await result<TranscriptionRecord[]>(
      db
        .transaction("transcriptions")
        .objectStore("transcriptions")
        .index("session_id")
        .getAll(sessionId),
    );
    for (const record of records)
      if (!transcriptionMemory.has(record.entry_id))
        transcriptionMemory.set(record.entry_id, record);
    transcriptionReadErrors.delete(sessionId);
  } catch (error) {
    transcriptionReadErrors.set(
      sessionId,
      error instanceof Error ? error.message : String(error),
    );
    if (!cached().length) throw error;
  }
  return cached().sort((a, b) =>
    a.created_at_utc.localeCompare(b.created_at_utc),
  );
}
export async function saveTranscription(record: TranscriptionRecord) {
  const prior = transcriptionMemory.get(record.entry_id);
  if (prior && JSON.stringify(prior) !== JSON.stringify(record))
    throw new Error(
      "Transcription records are immutable. Start a new attempt instead.",
    );
  if (prior && !transcriptionPending.has(record.entry_id)) return;
  transcriptionMemory.set(record.entry_id, structuredClone(record));
  transcriptionPending.add(record.entry_id);
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("transcriptions", "readwrite");
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error("Transcript storage failed"));
    tx.onerror = () => {};
    tx.objectStore("transcriptions").add(record);
  });
  transcriptionPending.delete(record.entry_id);
}
export async function retryTranscriptionWrites(sessionId: string) {
  for (const id of unsavedTranscriptionIds(sessionId))
    await saveTranscription(transcriptionMemory.get(id)!);
}
interface Write {
  session: Session;
  event?: RawEvent;
  audio?: AudioChunk;
  create?: boolean;
}
export class Journal {
  pending: Write[] = [];
  blocked = false;
  lastError: string | null = null;
  private running: Promise<void> | null = null;
  constructor(
    private changed: () => void,
    private failed: (e: unknown) => void,
  ) {}
  enqueue(write: Write) {
    this.pending.push(structuredClone(write));
    if (!this.blocked) void this.pump();
  }
  private pump(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        const db = await openDatabase();
        while (this.pending.length && !this.blocked) {
          const write = this.pending[0];
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(
              ["sessions", "events", "audio"],
              "readwrite",
            );
            tx.oncomplete = () => resolve();
            tx.onabort = () =>
              reject(tx.error ?? new Error("IndexedDB transaction aborted"));
            tx.onerror = () => {}; // onabort carries the terminal failure.
            const store = tx.objectStore("sessions");
            if (write.create) store.add(write.session);
            else store.put(write.session);
            if (write.event) tx.objectStore("events").add(write.event);
            if (write.audio) tx.objectStore("audio").add(write.audio);
          });
          this.pending.shift();
        }
      } catch (e) {
        this.blocked = true;
        this.lastError = e instanceof Error ? e.message : String(e);
        this.failed(e);
      } finally {
        this.running = null;
        this.changed();
      }
    })();
    return this.running;
  }
  async flush() {
    if (!this.blocked) await this.pump();
    return !this.blocked && !this.pending.length;
  }
  async retry() {
    this.blocked = false;
    this.lastError = null;
    await this.pump();
    return !this.blocked;
  }
}
