import type { RawEvent, Snapshot } from "./types";
import { segmentAudioFile } from "./timing";

export type WindowKind =
  "before_first_prompt" | "waiting" | "response" | "after_response";
export const windowLabels: Record<WindowKind, string> = {
  before_first_prompt: "Before first prompt",
  waiting: "Waiting",
  response: "Response appearing",
  after_response: "After response",
};
export interface WindowBoundary {
  event_id: string | null;
  type: string;
  t_ms: number;
  source: "event" | "session_metadata" | "last_observed";
}
export interface ReviewWindow {
  window_id: string;
  kind: WindowKind;
  label: string;
  start_t_ms: number;
  end_t_ms: number;
  duration_ms: number;
  start_boundary: WindowBoundary;
  end_boundary: WindowBoundary;
  request_id: string | null;
  previous_request_id: string | null;
  next_request_id: string | null;
  response_outcome: string | null;
  censored: boolean;
}
export interface WindowAudioPart {
  segment_id: string;
  audio_file: string;
  start_t_ms: number;
  end_t_ms: number;
  audio_start_seconds: number;
  audio_end_seconds: number;
  mapping_status: "mapped" | "uncertain";
}
export interface WindowPlayback {
  start_t_ms: number;
  end_t_ms: number;
  context_ms: number;
  parts: WindowAudioPart[];
  unavailable: { start_t_ms: number; end_t_ms: number; reason: string }[];
}
export interface WindowExchange {
  request_id: string;
  message_id: string;
  turn_index: number;
  before_window_id: string | null;
  waiting_window_id: string | null;
  response_window_id: string | null;
  after_window_id: string | null;
}
const boundary = (event: RawEvent): WindowBoundary => ({
  event_id: event.event_id,
  type: event.type,
  t_ms: event.t_ms,
  source: "event",
});
const metadata = (type: string, t_ms: number): WindowBoundary => ({
  event_id: null,
  type,
  t_ms,
  source: "session_metadata",
});
const earliest = (items: WindowBoundary[]) =>
  items.reduce((a, b) => (b.t_ms < a.t_ms ? b : a));
const terminalTypes = ["ai_completed", "ai_interrupted", "ai_failed"];

export function reviewWindows(snapshot: Snapshot) {
  const { session } = snapshot;
  const events = [...snapshot.events].sort((a, b) => a.sequence - b.sequence);
  const started = events.find((e) => e.type === "task_started");
  const start = started
    ? boundary(started)
    : Number.isFinite(session.task_started_t_ms)
      ? metadata("task_started", session.task_started_t_ms!)
      : null;
  const windows: ReviewWindow[] = [],
    exchanges: WindowExchange[] = [],
    issues: string[] = [];
  if (!start)
    return {
      task_start: null,
      task_end: null,
      windows,
      exchanges,
      issues: ["No task-start timestamp was recorded."],
    };
  const endings = events
    .filter(
      (e) =>
        ["final_submitted", "task_ended"].includes(e.type) &&
        e.t_ms >= start.t_ms,
    )
    .map(boundary);
  if (
    Number.isFinite(session.task_ended_t_ms) &&
    session.task_ended_t_ms! >= start.t_ms
  )
    endings.push(metadata("task_ended", session.task_ended_t_ms!));
  const end = endings.length
    ? earliest(endings)
    : {
        event_id: null,
        type: "last_observed",
        t_ms: Math.max(
          start.t_ms,
          session.last_t_ms ?? start.t_ms,
          ...events.map((e) => e.t_ms),
        ),
        source: "last_observed" as const,
      };
  if (end.source === "last_observed")
    issues.push(
      "Task end is unknown; unfinished intervals stop at the last observed session time.",
    );
  const prompts = events.filter(
    (e) =>
      e.type === "prompt_sent" &&
      e.t_ms >= start.t_ms &&
      e.t_ms <= end.t_ms &&
      typeof e.payload.request_id === "string",
  );
  const add = (
    kind: WindowKind,
    from: WindowBoundary,
    to: WindowBoundary,
    request: string | null,
    previous: string | null,
    next: string | null,
    outcome: string | null,
    censored = false,
  ) => {
    if (to.t_ms < from.t_ms) {
      issues.push(
        `Inconsistent boundaries for ${kind} (${request ?? "initial"}).`,
      );
      return null;
    }
    const window: ReviewWindow = {
      window_id: `${session.session_id}:${kind}:${from.event_id ?? `${from.type}-${from.t_ms}`}:${to.event_id ?? `${to.type}-${to.t_ms}`}`,
      kind,
      label: windowLabels[kind],
      start_t_ms: from.t_ms,
      end_t_ms: to.t_ms,
      duration_ms: to.t_ms - from.t_ms,
      start_boundary: from,
      end_boundary: to,
      request_id: request,
      previous_request_id: previous,
      next_request_id: next,
      response_outcome: outcome,
      censored: censored || to.source === "last_observed",
    };
    windows.push(window);
    return window.window_id;
  };
  add(
    "before_first_prompt",
    start,
    prompts[0] ? boundary(prompts[0]) : end,
    null,
    null,
    prompts[0] ? String(prompts[0].payload.request_id) : null,
    null,
  );
  for (let index = 0; index < prompts.length; index++) {
    const prompt = prompts[index],
      requestId = String(prompt.payload.request_id),
      nextPrompt = prompts[index + 1];
    const limit = nextPrompt ? boundary(nextPrompt) : end;
    const responseEvents = events.filter(
      (e) => e.payload.request_id === requestId && e.sequence > prompt.sequence,
    );
    const terminal = responseEvents.find((e) => terminalTypes.includes(e.type));
    const terminalInside =
      terminal && terminal.t_ms <= limit.t_ms ? boundary(terminal) : null;
    const responseEnd = terminalInside ?? limit;
    const first = responseEvents.find((e) => e.type === "ai_first_display");
    const firstInside =
      first &&
      first.t_ms <= responseEnd.t_ms &&
      (!terminal || first.sequence < terminal.sequence)
        ? boundary(first)
        : null;
    const outcome = terminalInside?.type.slice(3) ?? "unfinished";
    const waiting = add(
      "waiting",
      boundary(prompt),
      firstInside ?? responseEnd,
      requestId,
      null,
      null,
      outcome,
      !firstInside && !terminalInside,
    );
    const response = firstInside
      ? add(
          "response",
          firstInside,
          responseEnd,
          requestId,
          null,
          null,
          outcome,
          !terminalInside,
        )
      : null;
    const after = terminalInside
      ? add(
          "after_response",
          terminalInside,
          limit,
          requestId,
          requestId,
          nextPrompt ? String(nextPrompt.payload.request_id) : null,
          outcome,
        )
      : null;
    // Before the next prompt is a reference to an existing canonical interval, never a duplicate row.
    const preceding = windows
      .filter(
        (w) =>
          w.end_t_ms === prompt.t_ms &&
          w.start_t_ms <= prompt.t_ms &&
          w.request_id !== requestId,
      )
      .at(-1);
    exchanges.push({
      request_id: requestId,
      message_id: String(prompt.payload.message_id),
      turn_index: index + 1,
      before_window_id: preceding?.window_id ?? null,
      waiting_window_id: waiting,
      response_window_id: response,
      after_window_id: after,
    });
  }
  return { task_start: start, task_end: end, windows, exchanges, issues };
}

export function windowPlayback(
  snapshot: Snapshot,
  window: ReviewWindow,
  contextMs = 2000,
  bounds?: {
    task_start: WindowBoundary | null;
    task_end: WindowBoundary | null;
  },
): WindowPlayback {
  const data = bounds ?? reviewWindows(snapshot);
  const context = Math.max(0, Number.isFinite(contextMs) ? contextMs : 0);
  const start = Math.max(
    data.task_start?.t_ms ?? window.start_t_ms,
    window.start_t_ms - context,
  );
  const end = Math.min(
    data.task_end?.t_ms ?? window.end_t_ms,
    window.end_t_ms + context,
  );
  if (window.duration_ms <= 0)
    return {
      start_t_ms: start,
      end_t_ms: end,
      context_ms: context,
      parts: [],
      unavailable: [],
    };
  const blocked = snapshot.session.gaps.filter((g) =>
    g.kind.startsWith("audio"),
  );
  const parts: WindowAudioPart[] = [];
  const recordings = snapshot.session.audio_segments
    .map((segment, index) => ({ segment, index }))
    .sort((a, b) => a.segment.started_t_ms - b.segment.started_t_ms);
  for (const { segment, index } of recordings) {
    if (
      !snapshot.audio.some(
        (a) => a.segment_id === segment.segment_id && a.size > 0,
      )
    )
      continue;
    let spans = [
      {
        start: Math.max(start, segment.started_t_ms),
        end: Math.min(end, segment.ended_t_ms ?? snapshot.session.last_t_ms),
      },
    ].filter((span) => span.end > span.start);
    for (const gap of blocked)
      spans = spans.flatMap((span) => {
        const gapEnd = gap.end_t_ms ?? end;
        if (gapEnd <= span.start || gap.start_t_ms >= span.end) return [span];
        return [
          { start: span.start, end: Math.min(span.end, gap.start_t_ms) },
          { start: Math.max(span.start, gapEnd), end: span.end },
        ].filter((piece) => piece.end > piece.start);
      });
    for (const span of spans)
      parts.push({
        segment_id: segment.segment_id,
        audio_file: segmentAudioFile(segment, index),
        start_t_ms: span.start,
        end_t_ms: span.end,
        audio_start_seconds: (span.start - segment.started_t_ms) / 1000,
        audio_end_seconds: (span.end - segment.started_t_ms) / 1000,
        mapping_status:
          segment.ended_t_ms === undefined ||
          snapshot.session.gaps.some(
            (g) =>
              g.kind.startsWith("collector") &&
              g.start_t_ms < span.end &&
              (g.end_t_ms ?? end) > span.start,
          )
            ? "uncertain"
            : "mapped",
      });
  }
  parts.sort((a, b) => a.start_t_ms - b.start_t_ms);
  const unavailable: WindowPlayback["unavailable"] = [];
  let cursor = start;
  for (const part of parts) {
    if (part.start_t_ms > cursor)
      unavailable.push({
        start_t_ms: cursor,
        end_t_ms: part.start_t_ms,
        reason:
          "Recording gap, mute, missing audio bytes, or outside recorded coverage",
      });
    cursor = Math.max(cursor, part.end_t_ms);
  }
  if (cursor < end)
    unavailable.push({
      start_t_ms: cursor,
      end_t_ms: end,
      reason:
        "Recording gap, mute, missing audio bytes, or outside recorded coverage",
    });
  return {
    start_t_ms: start,
    end_t_ms: end,
    context_ms: context,
    parts,
    unavailable,
  };
}

export function reviewWindowManifest(snapshot: Snapshot) {
  const data = reviewWindows(snapshot);
  return {
    schema_version: "comparethink-review-windows-v1",
    session_id: snapshot.session.session_id,
    default_context_ms: 2000,
    policy:
      "Virtual review intervals, not research moves/nodes or STT utterances. Boundaries use prompt_sent, ai_first_display (text available to the view, not sample-accurate paint), AI terminal events, and final submission/task end. Missing ends are censored at the next prompt/task end or last observation. Before-prompt references reuse canonical intervals. Playback adds up to 2 s of context, is clamped to the task, and stops at each recorded part; gaps are never concatenated or crossed automatically.",
    ...data,
    windows: data.windows.map((window) => ({
      ...window,
      audio: windowPlayback(snapshot, window, 0, data),
      default_playback: windowPlayback(snapshot, window, 2000, data),
    })),
  };
}
