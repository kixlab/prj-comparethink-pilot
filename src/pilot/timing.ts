import type { AudioSegment, Snapshot } from "./types";

export const boundaryDefinitions: Record<
  string,
  { label: string; definition: string }
> = {
  task_started: {
    label: "Task started",
    definition: "Task start observed by the client after the recorder starts.",
  },
  prompt_sent: {
    label: "Prompt sent",
    definition:
      "Participant submits a chat message. This is not the start of typing.",
  },
  ai_request_started: {
    label: "AI request prepared",
    definition:
      "Client constructs the request before waiting for local persistence.",
  },
  ai_request_dispatched: {
    label: "AI request sent",
    definition:
      "Client calls fetch to the app server. Model receipt and internal generation start are not observed.",
  },
  ai_response_headers_received: {
    label: "AI response headers received",
    definition:
      "Client receives HTTP headers from the app server; this does not imply text is available.",
  },
  ai_first_text_received: {
    label: "AI first text received",
    definition: "Client observes the first non-empty streamed text delta.",
  },
  ai_first_display: {
    label: "AI first response",
    definition: "First text is made available to the React view.",
  },
  ai_paint_observed: {
    label: "AI display frame observed",
    definition:
      "requestAnimationFrame after React commit; approximate display observation, not hardware paint timing.",
  },
  ai_completed: {
    label: "AI response completed",
    definition:
      "Client receives the provider completion event through the app server.",
  },
  ai_stop_requested: {
    label: "AI stop requested",
    definition: "Participant or session end requests interruption.",
  },
  ai_interrupted: {
    label: "AI response interrupted",
    definition: "Client observes interruption; received text is retained.",
  },
  ai_failed: {
    label: "AI response failed",
    definition:
      "Client observes a request or stream failure; received text is retained.",
  },
  final_submitted: {
    label: "Final submission",
    definition: "Participant explicitly submits the final plan.",
  },
  task_ended: {
    label: "Task ended",
    definition: "Client ends the task and requests recorder stop.",
  },
};

export function segmentAudioFile(segment: AudioSegment, index: number) {
  const extension = segment.mime_type.includes("mp4")
    ? "mp4"
    : segment.mime_type.includes("ogg")
      ? "ogg"
      : segment.mime_type.includes("webm")
        ? "webm"
        : "bin";
  return `audio/segment-${String(index + 1).padStart(3, "0")}.${extension}`;
}

export function audioTimeline(snapshot: Snapshot) {
  const { session, events, audio } = snapshot;
  const turns = new Map<string, number>();
  for (const event of events)
    if (
      event.type === "prompt_sent" &&
      typeof event.payload.request_id === "string"
    )
      turns.set(event.payload.request_id, turns.size + 1);
  return events
    .filter((event) => Object.hasOwn(boundaryDefinitions, event.type))
    .map((event) => {
      const segmentIndex = session.audio_segments.findIndex(
        (segment) =>
          event.t_ms >= segment.started_t_ms &&
          event.t_ms <= (segment.ended_t_ms ?? session.last_t_ms),
      );
      const segment = session.audio_segments[segmentIndex];
      const gaps = session.gaps.filter(
        (gap) =>
          event.t_ms >= gap.start_t_ms &&
          event.t_ms <= (gap.end_t_ms ?? Infinity),
      );
      const audioGap = gaps.some((gap) => gap.kind.startsWith("audio"));
      const hasBytes =
        segment &&
        audio.some(
          (chunk) => chunk.segment_id === segment.segment_id && chunk.size > 0,
        );
      const uncertain =
        segment?.ended_t_ms === undefined ||
        gaps.some((gap) => gap.kind.startsWith("collector"));
      const mappingStatus = audioGap
        ? "gap"
        : !segment
          ? "outside_recording"
          : !hasBytes
            ? "unavailable"
            : uncertain
              ? "uncertain"
              : "mapped";
      const canMap =
        mappingStatus === "mapped" || mappingStatus === "uncertain";
      return {
        event_id: event.event_id,
        sequence: event.sequence,
        type: event.type,
        ...boundaryDefinitions[event.type],
        t_ms: event.t_ms,
        request_id:
          typeof event.payload.request_id === "string"
            ? event.payload.request_id
            : null,
        message_id:
          typeof event.payload.message_id === "string"
            ? event.payload.message_id
            : null,
        turn_index: turns.get(String(event.payload.request_id)) ?? null,
        segment_id: segment?.segment_id ?? null,
        audio_file: canMap ? segmentAudioFile(segment, segmentIndex) : null,
        audio_position_seconds: canMap
          ? (event.t_ms - segment.started_t_ms) / 1000
          : null,
        mapping_status: mappingStatus,
      };
    });
}
