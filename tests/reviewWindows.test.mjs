import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { loadTsBundle } from "../scripts/loadTsBundle.mjs";
const { reviewWindows, windowPlayback, reviewWindowManifest } =
  await loadTsBundle("src/pilot/reviewWindows.ts", "node");
const { buildArchive } = await loadTsBundle("src/pilot/export.ts", "node");

function fixture(entries, end = 16000) {
  const events = entries.map(([type, t_ms, request_id], index) => ({
    event_id: `e${index}`,
    session_id: "s",
    sequence: index + 1,
    t_ms,
    type,
    payload: request_id
      ? { request_id, message_id: `${request_id}-message`, text: "Hello" }
      : {},
  }));
  const segment = {
    segment_id: "mic1",
    started_t_ms: 1000,
    start_call_t_ms: 990,
    ended_t_ms: end + 100,
    mime_type: "audio/webm;codecs=opus",
    track_settings: {},
  };
  return {
    session: {
      session_id: "s",
      status: "completed",
      collection_status: "complete",
      issues: [],
      gaps: [],
      config: { task: { task_id: "test" } },
      clock: { origin_utc: "2026-11-05T00:00:00Z" },
      audio_segments: [segment],
      task_started_t_ms: 1000,
      task_ended_t_ms: end,
      last_t_ms: end + 100,
      final_answer: "Participant plan",
    },
    events,
    audio: [
      {
        chunk_id: "c1",
        segment_id: "mic1",
        index: 0,
        size: 3,
        blob: new Blob([new Uint8Array([1, 2, 3])]),
        mime_type: segment.mime_type,
      },
    ],
  };
}
const normal = () =>
  fixture([
    ["task_started", 1000],
    ["prompt_sent", 4000, "r1"],
    ["ai_first_text_received", 5900, "r1"],
    ["ai_first_display", 6000, "r1"],
    ["ai_completed", 8000, "r1"],
    ["prompt_sent", 10000, "r2"],
    ["ai_first_display", 11000, "r2"],
    ["ai_interrupted", 13000, "r2"],
    ["final_submitted", 16000],
    ["task_ended", 16001],
  ]);

test("canonical windows partition task time using displayed text and reuse the previous interval", () => {
  const snapshot = normal(),
    data = reviewWindows(snapshot);
  assert.deepEqual(
    data.windows.map((w) => [w.kind, w.start_t_ms, w.end_t_ms]),
    [
      ["before_first_prompt", 1000, 4000],
      ["waiting", 4000, 6000],
      ["response", 6000, 8000],
      ["after_response", 8000, 10000],
      ["waiting", 10000, 11000],
      ["response", 11000, 13000],
      ["after_response", 13000, 16000],
    ],
  );
  assert.equal(data.exchanges[0].before_window_id, data.windows[0].window_id);
  assert.equal(
    data.exchanges[1].before_window_id,
    data.exchanges[0].after_window_id,
  );
  assert.equal(new Set(data.windows.map((w) => w.window_id)).size, 7);
  assert.equal(data.windows[3].previous_request_id, "r1");
  assert.equal(data.windows[3].next_request_id, "r2");
  assert.equal(data.windows[5].response_outcome, "interrupted");
  assert.ok(data.windows.every((w) => !w.censored));
  assert.equal(
    data.windows.reduce((sum, w) => sum + w.duration_ms, 0),
    15000,
  );
  const padded = windowPlayback(snapshot, data.windows[1]);
  assert.deepEqual([padded.start_t_ms, padded.end_t_ms], [2000, 8000]);
  assert.equal(padded.parts[0].audio_start_seconds, 1);
  assert.equal(windowPlayback(snapshot, data.windows[0]).start_t_ms, 1000);
  assert.equal(windowPlayback(snapshot, data.windows.at(-1)).end_t_ms, 16000);
});

test("HTTP failure without displayed text has no response window; partial failure retains its response interval", () => {
  const data = reviewWindows(
    fixture(
      [
        ["task_started", 1000],
        ["prompt_sent", 2000, "r1"],
        ["ai_failed", 3000, "r1"],
        ["prompt_sent", 5000, "r2"],
        ["ai_first_display", 6000, "r2"],
        ["ai_failed", 7000, "r2"],
        ["final_submitted", 9000],
      ],
      9000,
    ),
  );
  assert.equal(data.exchanges[0].response_window_id, null);
  assert.deepEqual(
    data.windows
      .slice(1, 3)
      .map((w) => [w.kind, w.start_t_ms, w.end_t_ms, w.response_outcome]),
    [
      ["waiting", 2000, 3000, "failed"],
      ["after_response", 3000, 5000, "failed"],
    ],
  );
  assert.equal(
    data.windows.find((w) => w.kind === "response").duration_ms,
    1000,
  );
});

test("missing terminal is censored at next prompt, final submission or last observation without inventing completion", () => {
  const snapshot = fixture(
    [
      ["task_started", 1000],
      ["prompt_sent", 2000, "r1"],
      ["ai_first_display", 3000, "r1"],
      ["prompt_sent", 5000, "r2"],
      ["ai_completed", 6000, "r1"],
      ["final_submitted", 8000],
    ],
    8000,
  );
  const data = reviewWindows(snapshot);
  assert.equal(data.windows[2].end_t_ms, 5000);
  assert.equal(data.windows[2].censored, true);
  assert.equal(data.windows[2].response_outcome, "unfinished");
  assert.equal(data.exchanges[0].after_window_id, null);
  assert.equal(data.windows.at(-1).end_boundary.type, "final_submitted");
  assert.equal(data.windows.at(-1).censored, true);
  delete snapshot.session.task_ended_t_ms;
  snapshot.events.pop();
  snapshot.session.last_t_ms = 7500;
  const recovered = reviewWindows(snapshot);
  assert.equal(recovered.task_end.type, "last_observed");
  assert.equal(recovered.windows.at(-1).end_t_ms, 7500);
  assert.equal(recovered.issues.length, 1);
});

test("a task without prompts retains its initial interval and zero-duration windows have no playback", () => {
  const snapshot = fixture(
    [
      ["task_started", 1000],
      ["final_submitted", 8000],
    ],
    8000,
  );
  assert.equal(reviewWindows(snapshot).windows.length, 1);
  const zero = fixture(
    [
      ["task_started", 1000],
      ["prompt_sent", 1000, "r1"],
      ["ai_failed", 1000, "r1"],
      ["final_submitted", 2000],
    ],
    2000,
  );
  const window = reviewWindows(zero).windows[0];
  assert.equal(window.duration_ms, 0);
  assert.deepEqual(windowPlayback(zero, window).parts, []);
});

test("playback maps original recording parts separately, excludes mute/gaps/missing bytes and marks uncertainty", () => {
  const snapshot = normal();
  snapshot.session.audio_segments[0].ended_t_ms = 7000;
  snapshot.session.audio_segments.push({
    ...snapshot.session.audio_segments[0],
    segment_id: "mic2",
    started_t_ms: 9000,
    ended_t_ms: 16100,
  });
  snapshot.audio.push({
    ...snapshot.audio[0],
    chunk_id: "c2",
    segment_id: "mic2",
  });
  snapshot.session.gaps = [
    { kind: "audio", start_t_ms: 7000, end_t_ms: 9000 },
    { kind: "audio_muted", start_t_ms: 12000, end_t_ms: 12500 },
    { kind: "collector", start_t_ms: 13000, end_t_ms: 14000 },
  ];
  const window = {
    ...reviewWindows(snapshot).windows[0],
    start_t_ms: 1000,
    end_t_ms: 16000,
    duration_ms: 15000,
  };
  const playback = windowPlayback(snapshot, window, 0);
  assert.deepEqual(
    playback.parts.map((p) => [
      p.segment_id,
      p.start_t_ms,
      p.end_t_ms,
      p.mapping_status,
    ]),
    [
      ["mic1", 1000, 7000, "mapped"],
      ["mic2", 9000, 12000, "mapped"],
      ["mic2", 12500, 16000, "uncertain"],
    ],
  );
  assert.deepEqual(
    playback.unavailable.map((g) => [g.start_t_ms, g.end_t_ms]),
    [
      [7000, 9000],
      [12000, 12500],
    ],
  );
  assert.equal(playback.parts[1].audio_file, "audio/segment-002.webm");
  assert.equal(playback.parts[2].audio_start_seconds, 3.5);
  snapshot.audio.pop();
  assert.equal(windowPlayback(snapshot, window, 0).parts.length, 1);
  delete snapshot.session.audio_segments[0].ended_t_ms;
  assert.equal(
    windowPlayback(snapshot, window, 0).parts[0].mapping_status,
    "uncertain",
  );
});

test("export includes reproducible derived window metadata and preserves original events and audio bytes", async () => {
  const snapshot = normal(),
    before = JSON.stringify(snapshot.events);
  const files = unzipSync(await buildArchive(snapshot));
  const manifest = JSON.parse(strFromU8(files["audio/review_windows.json"]));
  assert.deepEqual(manifest, reviewWindowManifest(snapshot));
  assert.equal(manifest.windows[1].start_boundary.event_id, "e1");
  assert.equal(manifest.windows[1].end_boundary.event_id, "e3");
  assert.equal(manifest.windows[1].audio.parts[0].audio_start_seconds, 3);
  assert.equal(
    manifest.windows[1].default_playback.parts[0].audio_start_seconds,
    1,
  );
  assert.deepEqual([...files["audio/segment-001.webm"]], [1, 2, 3]);
  assert.equal(
    strFromU8(files["events.jsonl"]),
    snapshot.events.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  assert.equal(JSON.stringify(snapshot.events), before);
  assert.equal(
    JSON.parse(strFromU8(files["audio/manifest.json"])).review_windows_file,
    "audio/review_windows.json",
  );
});
