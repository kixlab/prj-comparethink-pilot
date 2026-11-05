import { zip, strToU8 } from "fflate";
import type { Message, Snapshot } from "./types";
import { audioTimeline, boundaryDefinitions, segmentAudioFile } from "./timing";
import { displayTranscriptions } from "./transcriptionTypes";
import { reviewWindowManifest } from "./reviewWindows";
export function messagesFromEvents(events: Snapshot["events"]): Message[] {
  const messages = new Map<string, Message>();
  for (const event of events) {
    const p = event.payload;
    if (event.type === "prompt_sent")
      messages.set(String(p.message_id), {
        message_id: String(p.message_id),
        request_id: String(p.request_id),
        role: "user",
        content: String(p.text),
        created_t_ms: event.t_ms,
        status: "sent",
      });
    if (event.type === "ai_request_started")
      messages.set(String(p.message_id), {
        message_id: String(p.message_id),
        request_id: String(p.request_id),
        role: "assistant",
        content: "",
        created_t_ms: event.t_ms,
        status: "streaming",
      });
    const m = messages.get(String(p.message_id));
    if (!m) continue;
    if (event.type === "ai_request_dispatched")
      m.request_dispatched_t_ms = event.t_ms;
    if (event.type === "ai_response_headers_received")
      m.headers_received_t_ms = event.t_ms;
    if (event.type === "ai_first_text_received")
      m.first_received_t_ms = event.t_ms;
    if (event.type === "ai_first_display") m.first_display_t_ms = event.t_ms;
    if (event.type === "ai_paint_observed") m.paint_observed_t_ms = event.t_ms;
    if (event.type === "ai_text_received") m.content += String(p.text);
    if (["ai_completed", "ai_interrupted", "ai_failed"].includes(event.type)) {
      m.status = event.type.slice(3) as Message["status"];
      m.ended_t_ms = event.t_ms;
    }
  }
  return [...messages.values()];
}
const json = (value: unknown) => strToU8(JSON.stringify(value, null, 2) + "\n");
export async function buildArchive(
  snapshot: Snapshot,
  unsavedWrites = 0,
): Promise<Uint8Array> {
  const { events, audio } = snapshot;
  const session = structuredClone(snapshot.session);
  const recovered = session.status === "active";
  if (recovered) {
    session.status = "interrupted";
    session.collection_status = "incomplete";
    session.issues.push(
      "Exported unfinished session: capture ended at an unknown time after the last persisted event.",
    );
    session.gaps.push({
      kind: "collector",
      start_t_ms: session.last_t_ms,
      reason: "Unclean session ending; end time unknown",
    });
  }
  const messages = messagesFromEvents(events);
  for (const m of messages)
    if (m.status === "streaming") m.status = "interrupted";
  if (unsavedWrites) {
    session.collection_status = "incomplete";
    session.issues.push(
      `${unsavedWrites} writes were not persisted; this export includes the current in-memory journal.`,
    );
  }
  const files: Record<string, Uint8Array> = {
    "session.json": json({
      ...session,
      export: {
        exported_at_utc: new Date().toISOString(),
        pending_writes: unsavedWrites,
        recovered_unfinished: recovered,
      },
    }),
    "task.json": json(session.config.task),
    "events.jsonl": strToU8(
      events.map((e) => JSON.stringify(e)).join("\n") +
        (events.length ? "\n" : ""),
    ),
    "messages.json": json(messages),
    "final_answer.txt": strToU8(session.final_answer ?? ""),
  };
  if (snapshot.transcriptions?.length || snapshot.transcription_read_error) {
    const entries = snapshot.transcriptions ?? [];
    const displayed = displayTranscriptions(entries);
    files["transcriptions.json"] = json({
      schema_version: "comparethink-transcriptions-v1",
      session_id: session.session_id,
      entries,
      display_attempt_ids: displayed.map((r) => r.attempt_id),
      unsaved_entry_ids: snapshot.unsaved_transcription_ids ?? [],
      read_error: snapshot.transcription_read_error ?? null,
      note: "Post-task derived transcripts. Every attempt is retained. Speech timestamps are estimates anchored to each original recording segment. This does not change raw collection_status.",
    });
    const cues = displayed
      .flatMap((record) => record.result?.cues ?? [])
      .sort((a, b) => a.start_t_ms - b.start_t_ms);
    files["transcript.txt"] = strToU8(
      displayed
        .map((record) =>
          [
            `Recording ${record.segment_id} · ${record.configuration.provider} · ${record.configuration.model}`,
            ...(record.result?.cues ?? []).map(
              (cue) =>
                `[${(cue.start_t_ms / 1000).toFixed(3)}–${(cue.end_t_ms / 1000).toFixed(3)} s] ${cue.text}`,
            ),
            ...(record.result?.untimed_text
              ? [`[Untimed] ${record.result.untimed_text}`]
              : []),
          ].join("\n"),
        )
        .join("\n\n") + "\n",
    );
    const vttTime = (ms: number) => {
      const value = Math.floor(Math.max(0, ms));
      return `${String(Math.floor(value / 3600000)).padStart(2, "0")}:${String(Math.floor(value / 60000) % 60).padStart(2, "0")}:${String(Math.floor(value / 1000) % 60).padStart(2, "0")}.${String(value % 1000).padStart(3, "0")}`;
    };
    files["transcript.vtt"] = strToU8(
      "WEBVTT\n\nNOTE Timestamps use the session clock, including recording gaps.\n\n" +
        cues
          .map(
            (cue, index) =>
              `${index + 1}\n${vttTime(cue.start_t_ms)} --> ${vttTime(cue.end_t_ms)}\n${cue.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}\n`,
          )
          .join("\n"),
    );
  }
  const manifest = [];
  for (let i = 0; i < session.audio_segments.length; i++) {
    const segment = session.audio_segments[i];
    const chunks = audio
      .filter((a) => a.segment_id === segment.segment_id)
      .sort((a, b) => a.index - b.index);
    const joinedFile = segmentAudioFile(segment, i);
    const extension = joinedFile.split(".").at(-1);
    const prefix = `segment-${String(i + 1).padStart(3, "0")}`;
    const entries = [];
    for (const chunk of chunks) {
      const file = `audio/chunks/${prefix}-${String(chunk.index).padStart(6, "0")}.${extension}`;
      files[file] = new Uint8Array(await chunk.blob.arrayBuffer());
      const { blob: _, ...metadata } = chunk;
      entries.push({ ...metadata, file });
    }
    files[joinedFile] = new Uint8Array(
      await new Blob(
        chunks.map((c) => c.blob),
        { type: segment.mime_type },
      ).arrayBuffer(),
    );
    manifest.push({ ...segment, file: joinedFile, chunks: entries });
  }
  files["audio/manifest.json"] = json({
    segments: manifest,
    timeline_file: "audio/timeline.json",
    review_windows_file: "audio/review_windows.json",
    time_unit: "ms",
    seek: "For an event inside a recorded segment: audio_position_seconds = (event.t_ms - segment.started_t_ms) / 1000. Never seek across a recorded gap.",
    timing_limits:
      "started_t_ms is the observed MediaRecorder start event, start_call_t_ms is the immediately preceding start() call. Browser scheduling and hardware latency limit precision; these are not sample-accurate speech timestamps. Chunk received_t_ms is delivery time, NOT an audio boundary; recorder_timecode_ms is preserved verbatim. Concatenate all chunks in index order within each segment; chunks need not be independently playable.",
    expected_timeslice_ms: 1000,
    gaps: session.gaps,
  });
  files["audio/review_windows.json"] = json(reviewWindowManifest(snapshot));
  files["audio/timeline.json"] = json({
    schema_version: "comparethink-audio-timeline-v1",
    session_id: session.session_id,
    time_origin_utc: session.clock.origin_utc,
    event_time_unit: "ms",
    audio_position_unit: "seconds",
    timing_basis:
      "Client-observed events on the session monotonic clock. Model receipt and internal generation start are not observed. No server clock synchronization is assumed.",
    alignment:
      "audio_position_seconds = (event.t_ms - segment.started_t_ms) / 1000. Approximate due to browser scheduling and microphone latency; not sample-accurate. mapped means a position can be calculated in a segment containing audio bytes, not proof of speech or loss-free audio. uncertain indicates an unfinished segment or collector gap. Unmappable positions are null; never bridge recording gaps.",
    boundary_definitions: boundaryDefinitions,
    markers: audioTimeline({ session, events, audio }),
  });
  return new Promise((resolve, reject) =>
    zip(files, { level: 0 }, (err, data) =>
      err ? reject(err) : resolve(data),
    ),
  );
}
export function downloadArchive(data: Uint8Array, sessionId: string) {
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(data).buffer], { type: "application/zip" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `comparethink-${sessionId}.zip`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
