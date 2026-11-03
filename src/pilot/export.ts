import { zip, strToU8 } from "fflate";
import type { Message, Snapshot } from "./types";
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
    if (event.type === "ai_first_display") m.first_display_t_ms = event.t_ms;
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
  const manifest = [];
  for (let i = 0; i < session.audio_segments.length; i++) {
    const segment = session.audio_segments[i];
    const chunks = audio
      .filter((a) => a.segment_id === segment.segment_id)
      .sort((a, b) => a.index - b.index);
    const extension = segment.mime_type.includes("mp4")
      ? "mp4"
      : segment.mime_type.includes("ogg")
        ? "ogg"
        : segment.mime_type.includes("webm")
          ? "webm"
          : "bin";
    const prefix = `segment-${String(i + 1).padStart(3, "0")}`;
    const joinedFile = `audio/${prefix}.${extension}`;
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
    time_unit: "ms",
    seek: "For an event inside a recorded segment: audio_position_seconds = (event.t_ms - segment.started_t_ms) / 1000. Never seek across a recorded gap.",
    timing_limits:
      "started_t_ms is the observed MediaRecorder start event, start_call_t_ms is the immediately preceding start() call. Browser scheduling and hardware latency limit precision; these are not sample-accurate speech timestamps. Chunk received_t_ms is delivery time, NOT an audio boundary; recorder_timecode_ms is preserved verbatim. Concatenate all chunks in index order within each segment; chunks need not be independently playable.",
    expected_timeslice_ms: 1000,
    gaps: session.gaps,
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
