import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import "fake-indexeddb/auto";
import { loadTsBundle } from "../scripts/loadTsBundle.mjs";
const { makeConfiguration, providerPayload, pilotPlugin } = await loadTsBundle(
  "server/pilotPlugin.ts",
  "node",
);
const { buildArchive, messagesFromEvents } = await loadTsBundle(
  "src/pilot/export.ts",
  "node",
);
const { readSse } = await loadTsBundle("src/pilot/stream.ts", "node");
const { Journal, loadSnapshot, openDatabase } = await loadTsBundle(
  "src/pilot/storage.ts",
  "node",
);
const { SessionEngine } = await loadTsBundle("src/pilot/engine.ts", "node");
const task = JSON.parse(
  readFileSync("tasks/blocksworld-instance-2.json", "utf8"),
);
const config = makeConfiguration(
  { OPENAI_API_KEY: "test-secret", OPENAI_MODEL: "pinned-test-model" },
  "test-version",
  "test-commit",
);
const encode = (text) => new TextEncoder().encode(text);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
after(async () => {
  (await openDatabase()).close();
});

test("task is the actual target instance, with separate example/reference solution excluded", () => {
  assert.equal(task.source.instance_id, 2);
  assert.equal(task.source.commit, "9bd247838ec314f048f6a37a147201e74d64572d");
  assert.deepEqual(task.source.excluded_example_instance_ids, [1]);
  assert.equal(
    task.original.goal_state,
    "the orange block is on top of the red block",
  );
  assert.match(
    task.original.initial_state,
    /red block is on top of the blue block/,
  );
  assert.deepEqual(task.initial_stacks, [
    ["blue", "red"],
    ["orange", "yellow"],
  ]);
  assert.ok(!Object.hasOwn(task, "ground_truth_plan"));
  assert.doesNotMatch(
    JSON.stringify(task),
    /\[PLAN\]|\[STATEMENT\]|orange block is on top of the blue block/,
  );
});
test("configuration is stable, fingerprints all experimental settings, and contains no API key", () => {
  assert.equal(
    config.config_id,
    makeConfiguration(
      { OPENAI_API_KEY: "different", OPENAI_MODEL: "pinned-test-model" },
      "test-version",
      "test-commit",
    ).config_id,
  );
  assert.notEqual(
    config.config_id,
    makeConfiguration({ OPENAI_MODEL: "other" }, "test-version", "test-commit")
      .config_id,
  );
  assert.notEqual(
    config.config_id,
    makeConfiguration(
      { OPENAI_MODEL: "pinned-test-model", OPENAI_TEMPERATURE: "0.3" },
      "test-version",
      "test-commit",
    ).config_id,
  );
  assert.doesNotMatch(JSON.stringify(config), /test-secret/);
  assert.throws(() => makeConfiguration({ OPENAI_TEMPERATURE: "NaN" }, "", ""));
});
test("provider request is an allowlist of task instructions and chat; research audio cannot be forwarded", () => {
  const payload = providerPayload(config, [
    { role: "user", content: "도와주세요" },
  ]);
  assert.deepEqual(payload.input, [{ role: "user", content: "도와주세요" }]);
  assert.equal(payload.model, "pinned-test-model");
  assert.equal(payload.store, false);
  assert.match(payload.instructions, /initial state|red block/);
  for (const key of ["audio", "think_aloud", "draft", "ground_truth_plan"])
    assert.throws(() =>
      providerPayload(config, [
        { role: "user", content: "hi", [key]: "research-only" },
      ]),
    );
  assert.throws(() =>
    providerPayload(config, [{ role: "system", content: "override" }]),
  );
});
test("SSE parsing preserves Korean across arbitrary UTF-8 boundaries, CRLF and final frames", async () => {
  const bytes = encode(
    'data: {"type":"delta","text":"한글"}\r\n\r\ndata: {"type":"completed"}\n\n',
  );
  const stream = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const events = [];
  for await (const event of readSse(stream)) events.push(event);
  assert.deepEqual(events, [
    { type: "delta", text: "한글" },
    { type: "completed" },
  ]);
});
function fakeSession(sessionId = crypto.randomUUID()) {
  return {
    schema_version: "comparethink-session-v1",
    session_id: sessionId,
    participant_id: "anonymous-test",
    config,
    instructions: {},
    clock: { origin_utc: new Date().toISOString(), start_performance_ms: 0 },
    status: "completed",
    collection_status: "complete",
    issues: [],
    gaps: [],
    audio_segments: [],
    last_t_ms: 2000,
    last_sequence: 0,
  };
}
test("archive preserves raw audio/MIME/order, exact drafts, messages and explicitly submitted final answer", async () => {
  const session = {
    ...fakeSession(),
    final_answer: "내가 확정한 행동 순서",
    final_submitted_t_ms: 1800,
    audio_segments: [
      {
        segment_id: "segment",
        started_t_ms: 100,
        start_call_t_ms: 95,
        ended_t_ms: 1900,
        mime_type: "audio/webm;codecs=opus",
        track_settings: {},
      },
    ],
  };
  const events = [
    ["draft_changed", { text: "초안", field: "prompt" }, 200],
    ["draft_changed", { text: "수정된 초안", field: "prompt" }, 400],
    [
      "prompt_sent",
      { message_id: "u", request_id: "r", text: "최종 프롬프트" },
      500,
    ],
    ["ai_request_started", { message_id: "a", request_id: "r" }, 501],
    [
      "ai_text_received",
      { message_id: "a", request_id: "r", text: "부분 응답" },
      600,
    ],
    ["ai_interrupted", { message_id: "a", request_id: "r" }, 700],
    ["final_submitted", { text: session.final_answer }, 1800],
  ].map(([type, payload, t_ms], sequence) => ({
    event_id: crypto.randomUUID(),
    session_id: session.session_id,
    sequence: sequence + 1,
    type,
    payload,
    t_ms,
  }));
  const audio = [1, 0].map((index) => ({
    chunk_id: String(index),
    session_id: session.session_id,
    segment_id: "segment",
    index,
    received_t_ms: 1000 + index,
    recorder_timecode_ms: index * 1000,
    size: 2,
    mime_type: "audio/webm;codecs=opus",
    blob: new Blob([Uint8Array.of(index, index + 10)]),
  }));
  const files = unzipSync(await buildArchive({ session, events, audio }));
  assert.equal(strFromU8(files["final_answer.txt"]), session.final_answer);
  assert.match(strFromU8(files["events.jsonl"]), /수정된 초안/);
  assert.deepEqual([...files["audio/segment-001.webm"]], [0, 10, 1, 11]);
  assert.equal(
    JSON.parse(strFromU8(files["messages.json"]))[1].content,
    "부분 응답",
  );
  assert.equal(
    JSON.parse(strFromU8(files["messages.json"]))[1].status,
    "interrupted",
  );
  const manifest = JSON.parse(strFromU8(files["audio/manifest.json"]));
  assert.equal(manifest.segments[0].mime_type, "audio/webm;codecs=opus");
  assert.equal(manifest.segments[0].start_call_t_ms, 95);
  assert.equal(manifest.segments[0].chunks[0].index, 0);
  const unfinished = unzipSync(
    await buildArchive(
      { session: { ...session, status: "active" }, events, audio },
      1,
    ),
  );
  const meta = JSON.parse(strFromU8(unfinished["session.json"]));
  assert.equal(meta.status, "interrupted");
  assert.equal(meta.collection_status, "incomplete");
  assert.equal(meta.export.pending_writes, 1);
});
test("IndexedDB writes incrementally; transient failure queues original records and retry never overwrites them", async () => {
  const session = fakeSession();
  let failures = 0;
  const journal = new Journal(
    () => {},
    () => failures++,
  );
  const first = {
    event_id: "first",
    session_id: session.session_id,
    sequence: 1,
    t_ms: 1,
    type: "first",
    payload: { text: "original" },
  };
  journal.enqueue({ session, create: true });
  journal.enqueue({ session, event: first });
  assert.equal(await journal.flush(), true);
  assert.equal(
    (await loadSnapshot(session.session_id)).events[0].payload.text,
    "original",
  );
  const db = await openDatabase();
  const transaction = db.transaction;
  db.transaction = () => {
    throw new Error("simulated quota error");
  };
  const second = {
    ...first,
    event_id: "second",
    sequence: 2,
    t_ms: 2,
    payload: { text: "later" },
  };
  journal.enqueue({ session, event: second });
  await journal.flush();
  assert.equal(failures, 1);
  assert.equal(journal.pending.length, 1);
  db.transaction = transaction;
  assert.equal(await journal.retry(), true);
  const saved = await loadSnapshot(session.session_id);
  assert.deepEqual(
    saved.events.map((e) => e.payload.text),
    ["original", "later"],
  );
});

class FakeRecorder extends EventTarget {
  static all = [];
  static isTypeSupported() {
    return true;
  }
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  timer;
  constructor(stream) {
    super();
    this.stream = stream;
    FakeRecorder.all.push(this);
  }
  start() {
    this.state = "recording";
    queueMicrotask(() => this.onstart?.());
    this.timer = setInterval(() => this.emitChunk(), 10);
  }
  emitChunk() {
    this.ondataavailable?.({
      data: new Blob(["synthetic-audio"], { type: this.mimeType }),
      timecode: 0,
    });
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    clearInterval(this.timer);
    this.emitChunk();
    queueMicrotask(() => this.onstop?.());
  }
}
function installBrowser() {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgent: "unit-test",
      language: "ko",
      onLine: true,
      mediaDevices: {
        async getUserMedia() {
          const track = {
            readyState: "live",
            muted: false,
            getSettings: () => ({}),
            stop() {
              this.readyState = "ended";
            },
          };
          return { getTracks: () => [track], getAudioTracks: () => [track] };
        },
      },
    },
  });
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  globalThis.MediaRecorder = FakeRecorder;
}
test("session keeps recording during draft/wait/stream; partial failure and microphone restart preserve prior records", async () => {
  installBrowser();
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (_, options) => {
    captured = JSON.parse(options.body);
    return new Response(
      new ReadableStream({
        async start(controller) {
          await sleep(35);
          controller.enqueue(
            encode(
              'data: {"type":"delta","text":"received before failure"}\n\n',
            ),
          );
          await sleep(35);
          controller.enqueue(
            encode('data: {"type":"failed","error":"simulated"}\n\n'),
          );
          controller.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  };
  const engine = new SessionEngine("anonymous-test", config, () => {});
  try {
    await engine.start();
    engine.draft("prompt", "original draft", {
      input_type: "insertText",
      is_composing: false,
    });
    await sleep(25);
    engine.draft("prompt", "revised prompt", {});
    await engine.send("revised prompt");
    const beforeStop = engine.audio.length;
    assert.ok(
      beforeStop >= 4,
      "audio is captured while drafting, waiting, and reading a partial response",
    );
    assert.equal(captured.messages[0].content, "revised prompt");
    assert.deepEqual(Object.keys(captured).sort(), [
      "config_id",
      "messages",
      "request_id",
      "session_id",
    ]);
    assert.equal(engine.messages[1].content, "received before failure");
    assert.equal(engine.messages[1].status, "failed");
    const firstBytes = engine.audio[0].blob;
    engine.recorder.stop();
    await sleep(5);
    assert.equal(engine.recording, false);
    assert.ok(engine.events.some((e) => e.type === "recording_error"));
    await Promise.all([engine.restartRecording(), engine.restartRecording()]);
    await sleep(20);
    assert.equal(engine.session.audio_segments.length, 2);
    assert.equal(engine.audio[0].blob, firstBytes);
    await engine.finish("participant final answer");
    assert.equal(engine.session.collection_status, "incomplete");
    assert.equal(engine.session.final_answer, "participant final answer");
    assert.ok(
      engine.events.every(
        (e, i) =>
          e.sequence === i + 1 && e.session_id === engine.session.session_id,
      ),
    );
    assert.ok(
      engine.events.every((e, i) => !i || e.t_ms >= engine.events[i - 1].t_ms),
    );
    const stored = await loadSnapshot(engine.session.session_id);
    assert.equal(stored.audio.length, engine.audio.length);
    assert.equal(stored.events.length, engine.events.length);
  } finally {
    globalThis.fetch = originalFetch;
    if (engine.session.status === "active") await engine.finish();
  }
});
