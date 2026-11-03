import type { AudioChunk, RawEvent, Session, Snapshot } from "./types";
let opening: Promise<IDBDatabase> | undefined;
export function openDatabase(): Promise<IDBDatabase> {
  if (!opening)
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open("comparethink-pilot-v1", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("sessions", { keyPath: "session_id" });
        db.createObjectStore("events", { keyPath: ["session_id", "sequence"] });
        const audio = db.createObjectStore("audio", { keyPath: "chunk_id" });
        audio.createIndex("session_id", "session_id");
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
  return { session, events, audio };
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
