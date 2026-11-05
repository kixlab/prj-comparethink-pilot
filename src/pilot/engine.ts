import {
  instructionsForTask,
  audioConstraints,
  id,
  errorText,
  requestMicrophone,
} from "./types";
import type {
  AudioChunk,
  Configuration,
  Gap,
  Message,
  RawEvent,
  Session,
  Snapshot,
} from "./types";
import { Journal } from "./storage";
import { messagesFromEvents } from "./export";
import { readSse } from "./stream";

export class SessionEngine {
  readonly session: Session;
  readonly events: RawEvent[] = [];
  readonly audio: AudioChunk[] = [];
  readonly journal: Journal;
  recording = false;
  busy = false;
  ending = false;
  recorder: MediaRecorder | null = null;
  stream: MediaStream | null = null;
  private controller: AbortController | null = null;
  private requestDone: Promise<void> | null = null;
  private stopDone: Promise<void> | null = null;
  private recordingPromise: Promise<void> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private cleanups: (() => void)[] = [];
  private recorderStops: ((reason: string) => void)[] = [];
  private lastHeartbeat = 0;
  private requestIds: { request_id: string; message_id: string } | null = null;
  constructor(
    participantId: string,
    config: Configuration,
    private changed: () => void,
  ) {
    const start = performance.now();
    this.session = {
      schema_version: "comparethink-session-v1",
      session_id: id(),
      participant_id: participantId,
      config: structuredClone(config),
      instructions: instructionsForTask(config.task),
      collection_policy: {
        version: "submitted-chat-v1",
        draft_capture: false,
        audio: "continuous",
        timing: "client-observed",
      },
      clock: {
        origin_utc: new Date(performance.timeOrigin + start).toISOString(),
        performance_time_origin_ms: performance.timeOrigin,
        start_performance_ms: start,
        unit: "ms",
        method:
          "t_ms = performance.now() - start_performance_ms; UTC anchor = performance.timeOrigin + start_performance_ms",
      },
      status: "active",
      collection_status: "collecting",
      issues: [],
      gaps: [],
      audio_segments: [],
      last_sequence: 0,
      last_t_ms: 0,
      environment: {
        user_agent: navigator.userAgent,
        language: navigator.language,
        audio_constraints: audioConstraints,
      },
    };
    this.journal = new Journal(changed, (e) => {
      this.issue("storage", errorText(e));
      this.openGap("storage", errorText(e));
      this.log("storage_error", {
        error: errorText(e),
        pending_writes: this.journal.pending.length,
        retained_in_memory: true,
      });
    });
    this.journal.enqueue({ session: this.session, create: true });
    this.log("session_created", {
      instructions: this.session.instructions,
      task_id: config.task.task_id,
      task_kind: config.task.kind,
    });
  }
  now() {
    return Math.max(
      this.session.last_t_ms,
      Math.round(
        (performance.now() - this.session.clock.start_performance_ms) * 1000,
      ) / 1000,
    );
  }
  log(type: string, payload: Record<string, unknown> = {}, audio?: AudioChunk) {
    const event: RawEvent = {
      event_id: id(),
      session_id: this.session.session_id,
      sequence: ++this.session.last_sequence,
      t_ms: this.now(),
      type,
      payload: structuredClone(payload),
    };
    this.session.last_t_ms = event.t_ms;
    this.events.push(event);
    this.journal.enqueue({ session: this.session, event, audio });
    this.changed();
    return event;
  }
  private issue(kind: string, detail: string) {
    const text = `${kind}: ${detail}`;
    if (!this.session.issues.includes(text)) this.session.issues.push(text);
    this.session.collection_status = "incomplete";
  }
  private openGap(kind: string, reason: string, start = this.now()) {
    const gap: Gap = { kind, start_t_ms: start, reason };
    this.session.gaps.push(gap);
    this.log("collection_gap_started", { ...gap });
    return gap;
  }
  private closeGaps(kind: string) {
    for (const gap of this.session.gaps)
      if (gap.kind === kind && gap.end_t_ms === undefined) {
        gap.end_t_ms = this.now();
        this.log("collection_gap_ended", { ...gap });
      }
  }
  get audioHealthy() {
    return (
      this.recording &&
      Boolean(
        this.stream
          ?.getAudioTracks()
          .some((t) => t.readyState === "live" && !t.muted),
      )
    );
  }
  get messages(): Message[] {
    return messagesFromEvents(this.events);
  }
  get snapshot(): Snapshot {
    return { session: this.session, events: this.events, audio: this.audio };
  }
  async start() {
    if (!(await this.journal.flush()))
      throw new Error(
        "Could not initialize local storage. Retry saving before starting a new session.",
      );
    try {
      await this.startRecording();
      this.session.task_started_t_ms = this.now();
      this.log("task_started", {
        task_id: this.session.config.task.task_id,
        task_version: this.session.config.task.version,
      });
      this.listen();
    } catch (e) {
      this.issue("recording", errorText(e));
      this.log("recording_error", { error: errorText(e), phase: "start" });
      this.session.status = "interrupted";
      this.session.ended_t_ms = this.now();
      this.log("session_ended", { reason: "start_failed" });
      throw e;
    }
  }
  private startRecording(): Promise<void> {
    if (this.recording) return Promise.resolve();
    if (!this.recordingPromise)
      this.recordingPromise = this.beginRecording().finally(() => {
        this.recordingPromise = null;
      });
    return this.recordingPromise;
  }
  private async beginRecording() {
    const stream = await requestMicrophone();
    if (this.ending || this.session.status !== "active") {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("Session ended during microphone initialization");
    }
    this.stream = stream;
    let recorder: MediaRecorder;
    try {
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((m) => MediaRecorder.isTypeSupported(m));
      recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      throw e;
    }
    this.recorder = recorder;
    const segment = {
      segment_id: id(),
      start_call_t_ms: this.now(),
      started_t_ms: this.now(),
      mime_type: recorder.mimeType,
      track_settings: stream.getAudioTracks()[0].getSettings(),
    } as Session["audio_segments"][number];
    let chunkIndex = 0;
    let expectedStop = false;
    let stopReason = "unexpected";
    let rejectStart: ((reason: unknown) => void) | undefined;
    let resolveStop!: () => void;
    this.stopDone = new Promise<void>((resolve) => {
      resolveStop = resolve;
    });
    const stopNormally = (reason: string) => {
      expectedStop = true;
      stopReason = reason;
      if (recorder.state !== "inactive") recorder.stop();
    };
    this.recorderStops.push(stopNormally);
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      if (!segment.mime_type) segment.mime_type = event.data.type;
      const chunk: AudioChunk = {
        chunk_id: id(),
        session_id: this.session.session_id,
        segment_id: segment.segment_id,
        index: chunkIndex++,
        received_t_ms: this.now(),
        recorder_timecode_ms: Number.isFinite(event.timecode)
          ? event.timecode
          : null,
        size: event.data.size,
        mime_type: event.data.type || recorder.mimeType,
        blob: event.data,
      };
      this.audio.push(chunk);
      this.log(
        "audio_chunk_received",
        {
          chunk_id: chunk.chunk_id,
          segment_id: chunk.segment_id,
          index: chunk.index,
          size: chunk.size,
          mime_type: chunk.mime_type,
          recorder_timecode_ms: chunk.recorder_timecode_ms,
        },
        chunk,
      );
    };
    recorder.onstop = () => {
      segment.ended_t_ms = this.now();
      segment.stop_reason = stopReason;
      this.recording = false;
      if (!expectedStop) {
        this.issue("recording", "Unexpected recorder stop");
        this.openGap("audio", "Unexpected recorder stop");
        this.log("recording_error", {
          error: "Unexpected recorder stop",
          segment_id: segment.segment_id,
        });
      }
      rejectStart?.(new Error("Recorder stopped before starting"));
      this.log("recording_stopped", { ...segment, expected: expectedStop });
      stream.getTracks().forEach((t) => t.stop());
      resolveStop();
      this.changed();
    };
    recorder.onerror = (event) => {
      rejectStart?.(new Error("MediaRecorder failed to start"));
      this.issue("recording", "MediaRecorder error");
      this.log("recording_error", {
        segment_id: segment.segment_id,
        error: errorText(
          (event as Event & { error?: Error }).error ?? "MediaRecorder error",
        ),
      });
      this.openGap("audio", "MediaRecorder error");
      if (recorder.state !== "inactive") recorder.stop();
    };
    for (const track of stream.getAudioTracks()) {
      track.onended = () => {
        if (expectedStop) return;
        this.issue("recording", "Microphone track ended");
        this.log("recording_error", {
          error: "Microphone track ended",
          segment_id: segment.segment_id,
        });
        if (recorder.state !== "inactive") recorder.stop();
      };
      track.onmute = () => {
        this.issue("recording", "Microphone muted");
        this.openGap("audio_mute", "Microphone track muted");
        this.log("recording_muted", { segment_id: segment.segment_id });
      };
      track.onunmute = () => {
        this.closeGaps("audio_mute");
        this.log("recording_unmuted", { segment_id: segment.segment_id });
      };
    }
    await new Promise<void>((resolve, reject) => {
      rejectStart = reject;
      const startTimeout = setTimeout(() => {
        reject(new Error("MediaRecorder did not start within 10 seconds"));
        if (recorder.state !== "inactive") recorder.stop();
        stream.getTracks().forEach((t) => t.stop());
      }, 10000);
      const originalReject = rejectStart;
      rejectStart = (reason) => {
        clearTimeout(startTimeout);
        originalReject(reason);
      };
      recorder.onstart = () => {
        clearTimeout(startTimeout);
        rejectStart = undefined;
        segment.started_t_ms = this.now();
        segment.mime_type = recorder.mimeType;
        this.session.audio_segments.push(segment);
        this.recording = true;
        this.closeGaps("audio");
        this.closeGaps("audio_mute");
        this.log("recording_started", { ...segment });
        resolve();
      };
      try {
        segment.start_call_t_ms = this.now();
        recorder.start(1000);
      } catch (e) {
        clearTimeout(startTimeout);
        stream.getTracks().forEach((t) => t.stop());
        reject(e);
      }
    });
  }
  async restartRecording() {
    if (this.session.status !== "active" || this.ending) return;
    this.log("recording_restart_requested");
    try {
      if (this.recording && !this.audioHealthy) {
        this.recorderStops.at(-1)?.("microphone_reconnect");
        await this.waitForStop();
      }
      await this.startRecording();
    } catch (e) {
      this.issue("recording", errorText(e));
      this.log("recording_error", { error: errorText(e), phase: "restart" });
      throw e;
    }
  }
  async send(text: string) {
    if (
      !text.trim() ||
      this.busy ||
      this.ending ||
      this.session.status !== "active" ||
      this.journal.blocked ||
      !this.audioHealthy
    )
      return;
    const requestId = id(),
      userId = id(),
      assistantId = id();
    this.busy = true;
    this.log("prompt_sent", {
      message_id: userId,
      request_id: requestId,
      text,
    });
    const history = this.messages
      .filter((m) => m.role === "user" || m.content)
      .map((m) => ({ role: m.role, content: m.content }));
    this.log("ai_request_started", {
      message_id: assistantId,
      request_id: requestId,
      user_message_id: userId,
      config_id: this.session.config.config_id,
      history_message_ids: this.messages.map((m) => m.message_id),
      definition:
        "Client prepares the AI request; dispatch follows local persistence.",
    });
    this.requestIds = { request_id: requestId, message_id: assistantId };
    this.controller = new AbortController();
    this.requestDone = this.receive(
      history,
      this.requestIds,
      this.controller.signal,
    );
    await this.requestDone;
  }
  private async receive(
    history: { role: string; content: string }[],
    ids: { request_id: string; message_id: string },
    signal: AbortSignal,
  ) {
    let first = true;
    let finished = false;
    try {
      // Persist the prompt/request boundary before transmitting. Audio never enters this body.
      if (!(await this.journal.flush()))
        throw new Error("Local persistence failed before AI request");
      if (signal.aborted) throw new Error("Participant stopped response");
      this.log("ai_request_dispatched", {
        ...ids,
        definition:
          "Client calls fetch to the app server; not model receipt or generation start.",
      });
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          session_id: this.session.session_id,
          request_id: ids.request_id,
          config_id: this.session.config.config_id,
          messages: history,
        }),
      });
      this.log("ai_response_headers_received", {
        ...ids,
        http_status: response.status,
        definition:
          "Client receives HTTP response headers from the app server.",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      if (!response.body) throw new Error("Missing response stream");
      for await (const event of readSse(response.body)) {
        if (signal.aborted) break;
        if (event.type === "created")
          this.log("ai_provider_response", {
            ...ids,
            response_id: event.response_id,
            provider_model: event.model,
          });
        if (
          event.type === "delta" &&
          typeof event.text === "string" &&
          event.text
        ) {
          const received = this.log("ai_text_received", {
            ...ids,
            text: event.text,
          });
          if (first) {
            first = false;
            this.log("ai_first_text_received", {
              ...ids,
              source_event_id: received.event_id,
              definition:
                "Client receives the first non-empty text delta; internal generation start is not observed.",
            });
            this.log("ai_first_display", {
              ...ids,
              definition:
                "First text made available to the React view; paint timestamp is separately observed by ai_paint_observed.",
            });
          }
        }
        if (event.type === "completed") {
          this.log("ai_completed", {
            ...ids,
            response_id: event.response_id,
            usage: event.usage,
          });
          finished = true;
          break;
        }
        if (event.type === "failed")
          throw new Error(
            `${event.error}${event.details ? ": " + JSON.stringify(event.details) : ""}`,
          );
      }
      if (!finished)
        throw new Error(
          signal.aborted
            ? "Participant stopped response"
            : "Stream ended before completion",
        );
    } catch (e) {
      this.issue("ai", errorText(e));
      this.log(signal.aborted ? "ai_interrupted" : "ai_failed", {
        ...ids,
        error: errorText(e),
        partial_text_retained: true,
      });
    } finally {
      this.busy = false;
      this.controller = null;
      this.requestIds = null;
      this.changed();
    }
  }
  observePaint(messageId: string) {
    const message = this.messages.find((m) => m.message_id === messageId);
    if (
      message &&
      !this.events.some(
        (e) =>
          e.type === "ai_paint_observed" && e.payload.message_id === messageId,
      )
    )
      this.log("ai_paint_observed", {
        message_id: messageId,
        request_id: message.request_id,
        observation:
          "requestAnimationFrame following React commit; browser paint timing is approximate",
      });
  }
  cancel() {
    if (this.busy) {
      this.log("ai_stop_requested", this.requestIds ?? {});
      this.controller?.abort();
    }
  }
  async finish(finalAnswer?: string) {
    if (this.ending || this.session.status !== "active") return;
    this.ending = true;
    this.changed();
    if (finalAnswer !== undefined) {
      this.session.final_answer = finalAnswer;
      this.session.final_submitted_t_ms = this.now();
      this.log("final_submitted", {
        text: finalAnswer,
      });
    } else
      this.issue("collector", "Participant ended without final submission");
    this.session.task_ended_t_ms = this.now();
    this.log("task_ended", {
      reason:
        finalAnswer === undefined ? "participant_aborted" : "final_submitted",
    });
    this.cancel();
    // Stop audio immediately at task end; final chunk is persisted through ondataavailable.
    for (const cleanup of this.cleanups) cleanup();
    for (const stop of this.recorderStops) stop("session_end");
    await this.waitForStop();
    if (this.requestDone) await this.requestDone;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (!this.audio.some((c) => c.size > 0))
      this.issue("recording", "No audio bytes collected");
    for (const segment of this.session.audio_segments) {
      if (
        !this.audio.some(
          (c) => c.segment_id === segment.segment_id && c.size > 0,
        )
      )
        this.issue(
          "recording",
          `No audio bytes in segment ${segment.segment_id}`,
        );
    }
    this.session.ended_t_ms = this.now();
    for (const gap of this.session.gaps)
      if (gap.end_t_ms === undefined) gap.end_t_ms = this.session.ended_t_ms;
    this.session.status =
      finalAnswer === undefined ? "interrupted" : "completed";
    this.session.collection_status = this.session.issues.length
      ? "incomplete"
      : "complete";
    this.log("session_ended", {
      status: this.session.status,
      collection_status: this.session.collection_status,
    });
    await this.journal.flush();
    this.changed();
  }
  private async waitForStop() {
    if (!this.stopDone) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.stopDone,
      new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          this.issue(
            "recording",
            "Recorder stop timed out; final audio may be missing",
          );
          this.log("recording_error", {
            error: "Recorder stop timeout",
            final_chunk_uncertain: true,
          });
          this.stream?.getTracks().forEach((t) => t.stop());
          resolve();
        }, 5000);
      }),
    ]);
    clearTimeout(timeout);
  }
  async retryStorage() {
    if (await this.journal.retry()) {
      this.closeGaps("storage");
      this.log("storage_recovered", { prior_error_retained: true });
      await this.journal.flush();
    }
  }
  private listen() {
    const on = (
      target: Window | Document,
      type: string,
      handler: EventListener,
    ) => {
      target.addEventListener(type, handler);
      this.cleanups.push(() => target.removeEventListener(type, handler));
    };
    on(window, "offline", () => {
      this.issue("network", "Browser offline");
      this.openGap("network", "Browser offline");
      this.log("network_offline");
    });
    on(window, "online", () => {
      this.closeGaps("network");
      this.log("network_online");
    });
    on(document, "visibilitychange", () =>
      this.log("visibility_changed", { visibility: document.visibilityState }),
    );
    on(window, "pagehide", () => {
      this.issue("collector", "Page hidden/unloaded before a clean end");
      this.session.status = "interrupted";
      this.openGap(
        "collector",
        "Page exit; recording after this point cannot be guaranteed",
      );
      this.log("collector_interrupted", {
        reason: "pagehide",
        persistence: "best_effort",
      });
      this.controller?.abort();
      if (this.recorder?.state !== "inactive") this.recorder?.stop();
      this.stream?.getTracks().forEach((t) => t.stop());
    });
    on(window, "beforeunload", (event) => {
      if (this.session.status === "active") {
        event.preventDefault();
        (event as BeforeUnloadEvent).returnValue = "";
      }
    });
    this.lastHeartbeat = this.now();
    this.heartbeat = setInterval(() => {
      const now = this.now();
      if (now - this.lastHeartbeat > 6000) {
        this.issue(
          "collector",
          "Event loop suspension; capture continuity uncertain",
        );
        this.session.gaps.push({
          kind: "collector_suspension",
          start_t_ms: this.lastHeartbeat,
          end_t_ms: now,
          reason: "Heartbeat delayed >6 seconds; audio continuity uncertain",
        });
        this.log("collector_suspension", {
          from_t_ms: this.lastHeartbeat,
          to_t_ms: now,
        });
      }
      this.lastHeartbeat = now;
      this.log("collector_heartbeat", {
        recorder_state: this.recorder?.state,
        audio_bytes: this.audio.reduce((n, a) => n + a.size, 0),
        online: navigator.onLine,
      });
    }, 2000);
    if (!navigator.onLine) {
      this.issue("network", "Session started offline");
      this.openGap("network", "Session started offline");
      this.log("network_offline");
    }
  }
}
