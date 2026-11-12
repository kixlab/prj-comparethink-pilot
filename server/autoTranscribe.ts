import { createHash, randomUUID } from "node:crypto";
import type { SyncStore } from "./syncStore";
import { transcribeRecording, type SttSettings } from "./sttPlugin";
import type {
  TranscriptionRecord,
  TranscriptionResult,
} from "../src/pilot/transcriptionTypes";

export type Transcribe = (
  settings: SttSettings,
  bytes: Buffer,
  startedMs: number,
  signal: AbortSignal,
) => Promise<TranscriptionResult>;

export interface AutoTranscriberOptions {
  transcribe?: Transcribe;
  /** Quiet period after the last upload before a session is checked. */
  delayMs?: number;
  /** How often every stored session is re-checked (catch-up after restarts and failures). */
  scanIntervalMs?: number;
  /** A session still marked active is transcribed once no upload arrived for this long. */
  abandonedAfterMs?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  log?: Pick<Console, "log" | "error">;
}

type Outcome = "waiting" | "settled";

/**
 * Transcribes server copies of finished sessions without anyone pressing a button.
 * A recording segment is transcribed once every uploaded event and audio chunk of its session
 * is on the server. Results are add-only transcription records, the same format the browser
 * produces, marked generated_by: "server". Failed segments are retried up to maxAttempts.
 */
export class AutoTranscriber {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private chain: Promise<unknown> = Promise.resolve();
  private queued = new Map<string, Promise<Outcome>>();
  private settled = new Map<string, string>();
  private scanTimer?: ReturnType<typeof setInterval>;
  private transcribe: Transcribe;
  private delayMs: number;
  private scanIntervalMs: number;
  private abandonedAfterMs: number;
  private maxAttempts: number;
  private timeoutMs: number;
  private log: Pick<Console, "log" | "error">;
  constructor(
    private store: SyncStore,
    private settings: SttSettings,
    options: AutoTranscriberOptions = {},
  ) {
    this.transcribe =
      options.transcribe ??
      ((s, b, t, signal) => transcribeRecording(s, b, t, signal));
    this.delayMs = options.delayMs ?? 5_000;
    this.scanIntervalMs = options.scanIntervalMs ?? 10 * 60_000;
    this.abandonedAfterMs = options.abandonedAfterMs ?? 60 * 60_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.timeoutMs = options.timeoutMs ?? 15 * 60_000;
    this.log = options.log ?? console;
  }

  /** Periodic catch-up scan; the first one runs shortly after the server starts. */
  start() {
    if (this.scanTimer) return;
    const first = setTimeout(() => void this.scanAll(), 10_000);
    first.unref?.();
    this.scanTimer = setInterval(
      () => void this.scanAll(),
      this.scanIntervalMs,
    );
    this.scanTimer.unref?.();
  }
  stop() {
    clearInterval(this.scanTimer);
    this.scanTimer = undefined;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** Called after each upload; checks the session once uploads go quiet. */
  schedule(sessionId: string) {
    clearTimeout(this.timers.get(sessionId));
    const timer = setTimeout(() => {
      this.timers.delete(sessionId);
      void this.enqueue(sessionId);
    }, this.delayMs);
    timer.unref?.();
    this.timers.set(sessionId, timer);
  }

  async scanAll() {
    let sessions;
    try {
      sessions = await this.store.listSessions();
    } catch (error) {
      this.log.error("[auto-stt] could not list sessions:", errorText(error));
      return;
    }
    for (const summary of sessions) {
      const signature = `${summary.status}:${summary.event_count}:${summary.audio_chunk_count}:${summary.audio_bytes}`;
      if (this.settled.get(summary.session_id) === signature) continue;
      const lastUpload = summary.synced_at ? Date.parse(summary.synced_at) : 0;
      const abandoned = Date.now() - lastUpload > this.abandonedAfterMs;
      if ((await this.enqueue(summary.session_id, abandoned)) === "settled")
        this.settled.set(summary.session_id, signature);
    }
  }

  /** Runs one check at a time (one transcription at a time on the server). */
  enqueue(sessionId: string, abandoned = false): Promise<Outcome> {
    const waiting = this.queued.get(sessionId);
    if (waiting) return waiting;
    const run = this.chain
      .then(() => {
        this.queued.delete(sessionId);
        return this.process(sessionId, abandoned);
      })
      .catch((error): Outcome => {
        this.log.error(
          `[auto-stt] session ${sessionId} failed:`,
          errorText(error),
        );
        return "waiting";
      });
    this.queued.set(sessionId, run);
    this.chain = run;
    return run;
  }

  private async process(
    sessionId: string,
    abandoned: boolean,
  ): Promise<Outcome> {
    const stored = await this.store.loadSession(sessionId);
    if (!stored) return "waiting";
    const { session, events, audio, transcriptions } = stored;
    if (session.status === "active" && !abandoned) return "waiting";
    // Every event the browser wrote, and every audio chunk those events announce, must be here.
    if ((events.at(-1)?.sequence ?? -1) < session.last_sequence)
      return "waiting";
    const have = new Set(audio.map((chunk) => chunk.chunk_id));
    const announced = events
      .filter((event) => event.type === "audio_chunk_received")
      .map((event) => (event.payload as { chunk_id?: string }).chunk_id);
    if (announced.some((chunkId) => !chunkId || !have.has(chunkId)))
      return "waiting";

    const configuration = this.settings.configuration;
    for (const segment of session.audio_segments ?? []) {
      const chunks = audio
        .filter((chunk) => chunk.segment_id === segment.segment_id)
        .sort((a, b) => a.index - b.index);
      const total = chunks.reduce((n, chunk) => n + chunk.byte_length, 0);
      if (!chunks.some((chunk) => chunk.byte_length > 0)) continue;
      const records = transcriptions.filter(
        (r) =>
          r.segment_id === segment.segment_id &&
          r.configuration?.config_id === configuration.config_id &&
          r.source?.bytes === total,
      );
      if (records.some((r) => r.status === "completed")) continue;
      const attempts = records.filter(
        (r) => r.generated_by === "server" && r.status === "started",
      ).length;
      if (attempts >= this.maxAttempts) continue;

      const bytes = Buffer.concat(
        await Promise.all(chunks.map((chunk) => this.store.readAudio(chunk))),
      );
      const started: TranscriptionRecord = {
        schema_version: "comparethink-transcription-v1",
        entry_id: randomUUID(),
        attempt_id: randomUUID(),
        session_id: sessionId,
        segment_id: segment.segment_id,
        created_at_utc: new Date().toISOString(),
        status: "started",
        generated_by: "server",
        configuration: structuredClone(configuration),
        source: {
          started_t_ms: segment.started_t_ms,
          mime_type: segment.mime_type,
          bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      };
      await this.store.addTranscriptions(sessionId, [started]);
      const label = `session ${sessionId} segment ${segment.segment_id}`;
      try {
        const result = await this.transcribe(
          this.settings,
          bytes,
          segment.started_t_ms,
          AbortSignal.timeout(this.timeoutMs),
        );
        await this.store.addTranscriptions(sessionId, [
          {
            ...started,
            entry_id: randomUUID(),
            created_at_utc: new Date().toISOString(),
            status: result.status,
            result,
          },
        ]);
        this.log.log(
          `[auto-stt] ${label}: ${result.status}, ${result.cues.length} cues`,
        );
        if (result.status !== "completed") return "waiting";
      } catch (error) {
        await this.store.addTranscriptions(sessionId, [
          {
            ...started,
            entry_id: randomUUID(),
            created_at_utc: new Date().toISOString(),
            status: "failed",
            error: errorText(error),
          },
        ]);
        this.log.error(`[auto-stt] ${label} failed:`, errorText(error));
        return "waiting";
      }
    }
    // An abandoned session that is still active may receive more audio later.
    return session.status === "active" ? "waiting" : "settled";
  }
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
