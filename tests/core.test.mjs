import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
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
const { audioTimeline } = await loadTsBundle("src/pilot/timing.ts", "node");
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
const travelTask = JSON.parse(
  readFileSync("tasks/travelplanner-validation-row-0.json", "utf8"),
);
const travelConfig = makeConfiguration(
  { OPENAI_API_KEY: "test-secret", OPENAI_MODEL: "pinned-test-model" },
  "test-version",
  "test-commit",
  travelTask,
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
test("TravelPlanner uses a pinned official query and the complete supplied travel packet without answers", () => {
  assert.equal(travelTask.kind, "travelplanner");
  assert.equal(travelTask.source.dataset, "osunlp/TravelPlanner");
  assert.equal(
    travelTask.source.commit,
    "8736504ecfc31b7f8b7e40122873c337e83fff7c",
  );
  assert.equal(travelTask.source.split, "validation");
  assert.equal(travelTask.source.row_index, 0);
  assert.equal(travelTask.source.license, "CC-BY-4.0");
  assert.equal(
    travelTask.query,
    "Please create a travel plan for me where I'll be departing from Washington and heading to Myrtle Beach for a 3-day trip from March 13th to March 15th, 2022. Can you help me keep this journey within a budget of $1,400?",
  );
  assert.equal(travelTask.original.query, travelTask.query);
  assert.equal(Object.keys(travelTask.reference_information).length, 9);
  assert.equal(
    travelTask.reference_information["Attractions in Myrtle Beach"].length,
    20,
  );
  assert.equal(
    travelTask.reference_information["Restaurants in Myrtle Beach"].length,
    28,
  );
  assert.equal(
    travelTask.reference_information["Accommodations in Myrtle Beach"].length,
    19,
  );
  assert.equal(
    travelTask.reference_information[
      "Flight from Washington to Myrtle Beach on 2022-03-13"
    ][0]["Flight Number"],
    "F3792603",
  );
  const check = (value) => {
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) {
        assert.ok(
          ![
            "annotated_plan",
            "ground_truth_plan",
            "reference_plan",
            "solution",
            "answer",
          ].includes(key.toLowerCase()),
          key,
        );
        check(child);
      }
  };
  check(travelTask);
});
test("task-specific model context is complete, has distinct fingerprints, and excludes other tasks and researcher fields", () => {
  assert.notEqual(config.config_id, travelConfig.config_id);
  assert.equal(config.model, travelConfig.model);
  assert.deepEqual(config.generation, travelConfig.generation);
  const payload = providerPayload(travelConfig, [
    { role: "user", content: "Help with my itinerary" },
  ]);
  const context = JSON.parse(payload.instructions.split("\n\n").at(-1));
  assert.equal(context.kind, "travelplanner");
  assert.equal(context.query, travelTask.query);
  assert.deepEqual(
    context.reference_information,
    travelTask.reference_information,
  );
  assert.doesNotMatch(
    payload.instructions,
    /red block|initial_stacks|reference_file_sha256/,
  );
  assert.doesNotMatch(config.system_prompt, /Myrtle Beach|Flight Number/);
  const withPrivateFields = makeConfiguration({}, "test", "test", {
    ...travelTask,
    reference_plan: "DO_NOT_FORWARD",
    original: { ...travelTask.original, answer: "DO_NOT_FORWARD" },
  });
  assert.doesNotMatch(withPrivateFields.system_prompt, /DO_NOT_FORWARD/);
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
const bedrockEnv = {
  OPENAI_BASE_URL: "https://bedrock-mantle.us-east-1.api.aws/openai/v1/",
  OPENAI_PROJECT: "proj_test",
  OPENAI_MODEL: "openai.gpt-6.1-sol",
  OPENAI_API_KEY: "bedrock-test-token",
};
test("Bedrock endpoint, project and model are snapshotted and fingerprinted without credentials", () => {
  const bedrock = makeConfiguration(bedrockEnv, "test", "test");
  assert.equal(bedrock.provider, "bedrock-responses");
  assert.equal(bedrock.api_base_url, bedrockEnv.OPENAI_BASE_URL.slice(0, -1));
  assert.equal(bedrock.project, "proj_test");
  assert.equal(bedrock.model, "openai.gpt-6.1-sol");
  assert.equal(bedrock.api_ready, true);
  assert.doesNotMatch(JSON.stringify(bedrock), /bedrock-test-token/);
  for (const change of [
    { OPENAI_BASE_URL: "https://bedrock-mantle.us-west-2.api.aws/openai/v1" },
    { OPENAI_PROJECT: "proj_other" },
    { OPENAI_MODEL: "different-model" },
  ])
    assert.notEqual(
      bedrock.config_id,
      makeConfiguration({ ...bedrockEnv, ...change }, "test", "test").config_id,
    );
  assert.equal(
    bedrock.config_id,
    makeConfiguration(
      { ...bedrockEnv, OPENAI_API_KEY: "another-bedrock-token" },
      "test",
      "test",
    ).config_id,
  );
  assert.equal(
    makeConfiguration(
      { ...bedrockEnv, OPENAI_API_KEY: "sk-old-openai-key" },
      "test",
      "test",
    ).api_ready,
    false,
  );
  assert.equal(
    makeConfiguration({ OPENAI_API_KEY: "ABSK-test" }, "test", "test")
      .api_ready,
    false,
  );
  for (const url of [
    "http://bedrock-mantle.us-east-1.api.aws/openai/v1",
    "https://bedrock-mantle.us-east-1.api.aws.evil.example/openai/v1",
    "https://user:password@bedrock-mantle.us-east-1.api.aws/openai/v1",
    "https://bedrock-mantle.us-east-1.api.aws/openai/v1?token=secret",
  ])
    assert.throws(() =>
      makeConfiguration(
        { ...bedrockEnv, OPENAI_BASE_URL: url },
        "test",
        "test",
      ),
    );
});
test("Bedrock middleware sends the configured project and bearer key to its Responses endpoint and relays streaming events", async () => {
  const invoke = async (env, upstream) => {
    let handler;
    const plugin = pilotPlugin(env, "test", "test", upstream);
    plugin.configureServer({
      middlewares: {
        use(fn) {
          handler = fn;
        },
      },
    });
    const canonical = makeConfiguration(env, "test", "test");
    const request = {
      method: "POST",
      url: "/api/chat",
      headers: { host: "localhost" },
      socket: {},
      setEncoding() {},
      async *[Symbol.asyncIterator]() {
        yield JSON.stringify({
          session_id: "bedrock-test",
          request_id: "request-1",
          config_id: canonical.config_id,
          messages: [{ role: "user", content: "Hello" }],
        });
      },
    };
    const response = new EventEmitter();
    response.destroyed = false;
    response.status = 0;
    response.chunks = [];
    response.writeHead = (status) => {
      response.status = status;
    };
    response.flushHeaders = () => {};
    response.write = (text) => response.chunks.push(text);
    response.end = (text) => {
      if (text) response.chunks.push(text);
    };
    await handler(request, response, () => {
      throw new Error("Unexpected middleware fallthrough");
    });
    return response;
  };
  const calls = [];
  const upstream = async (url, options) => {
    calls.push({ url, options });
    return new Response(
      [
        {
          type: "response.created",
          response: { id: "bedrock-response", model: bedrockEnv.OPENAI_MODEL },
        },
        { type: "response.output_text.delta", delta: "Hello from Bedrock" },
        {
          type: "response.completed",
          response: { id: "bedrock-response", usage: { output_tokens: 4 } },
        },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(""),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  };
  const response = await invoke(bedrockEnv, upstream);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  const { url, options } = calls[0];
  assert.equal(
    url,
    "https://bedrock-mantle.us-east-1.api.aws/openai/v1/responses",
  );
  assert.equal(options.headers["OpenAI-Project"], "proj_test");
  assert.equal(options.headers.Authorization, "Bearer bedrock-test-token");
  assert.equal(options.redirect, "error");
  const body = JSON.parse(options.body);
  assert.equal(body.model, bedrockEnv.OPENAI_MODEL);
  assert.equal(body.stream, true);
  assert.equal(body.store, false);
  assert.deepEqual(body.input, [{ role: "user", content: "Hello" }]);
  assert.doesNotMatch(options.body, /bedrock-test-token|think_aloud|audio/);
  assert.match(response.chunks.join(""), /Hello from Bedrock/);
  assert.match(response.chunks.join(""), /"type":"completed"/);
  const rejected = await invoke(
    { ...bedrockEnv, OPENAI_API_KEY: "sk-old-openai-key" },
    upstream,
  );
  assert.equal(rejected.status, 503);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(rejected.chunks.join(""), /sk-old-openai-key/);
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
test("archive preserves legacy raw records, audio/MIME/order, messages and explicitly submitted final answer", async () => {
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
test("audio timeline maps each request to its own recording segment and exposes gaps, missing bytes and uncertain endings", async () => {
  const session = {
    ...fakeSession(),
    last_t_ms: 5000,
    gaps: [
      { kind: "audio", start_t_ms: 1000, end_t_ms: 2000 },
      { kind: "audio_mute", start_t_ms: 2200, end_t_ms: 2300 },
      { kind: "collector_suspension", start_t_ms: 2400, end_t_ms: 2500 },
    ],
    audio_segments: [
      {
        segment_id: "s1",
        started_t_ms: 100,
        ended_t_ms: 1000,
        mime_type: "audio/webm",
      },
      {
        segment_id: "s2",
        started_t_ms: 2000,
        ended_t_ms: 3000,
        mime_type: "audio/mp4",
      },
      {
        segment_id: "empty",
        started_t_ms: 3100,
        ended_t_ms: 3200,
        mime_type: "audio/ogg",
      },
      { segment_id: "unfinished", started_t_ms: 4000, mime_type: "audio/webm" },
    ],
  };
  const events = [
    ["prompt_sent", 500, "r1"],
    ["ai_failed", 1500, "r1"],
    ["prompt_sent", 2100, "r2"],
    ["ai_first_text_received", 2250, "r2"],
    ["ai_first_display", 2450, "r2"],
    ["ai_completed", 2600, "r2"],
    ["prompt_sent", 3150, "r3"],
    ["ai_failed", 3500, "r3"],
    ["prompt_sent", 4100, "r4"],
  ].map(([type, t_ms, request_id], index) => ({
    event_id: `e${index}`,
    session_id: session.session_id,
    sequence: index + 1,
    type,
    t_ms,
    payload: { request_id },
  }));
  const audio = ["s1", "s2", "unfinished"].map((segment_id) => ({
    segment_id,
    size: 3,
  }));
  const markers = audioTimeline({ session, events, audio });
  assert.deepEqual(
    markers.map((m) => m.mapping_status),
    [
      "mapped",
      "gap",
      "mapped",
      "gap",
      "uncertain",
      "mapped",
      "unavailable",
      "outside_recording",
      "uncertain",
    ],
  );
  assert.equal(markers[0].audio_position_seconds, 0.4);
  assert.equal(markers[2].audio_position_seconds, 0.1);
  assert.equal(markers[2].audio_file, "audio/segment-002.mp4");
  assert.equal(markers[2].turn_index, 2);
  for (const index of [1, 3, 6, 7]) {
    assert.equal(markers[index].audio_position_seconds, null);
    assert.equal(markers[index].audio_file, null);
  }
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
    await sleep(25);
    await engine.send("revised prompt");
    const beforeStop = engine.audio.length;
    assert.ok(
      beforeStop >= 4,
      "audio is captured while drafting, waiting, and reading a partial response",
    );
    assert.equal(captured.messages[0].content, "revised prompt");
    assert.equal(engine.session.collection_policy.draft_capture, false);
    assert.ok(
      !engine.events.some((event) => /draft|composition/.test(event.type)),
    );
    const boundaries = [
      "prompt_sent",
      "ai_request_started",
      "ai_request_dispatched",
      "ai_response_headers_received",
      "ai_first_text_received",
      "ai_first_display",
      "ai_failed",
    ];
    const sequences = boundaries.map(
      (type) => engine.events.find((e) => e.type === type).sequence,
    );
    assert.deepEqual(
      [...sequences].sort((a, b) => a - b),
      sequences,
    );
    assert.equal(
      engine.messages[1].request_dispatched_t_ms,
      engine.events.find((e) => e.type === "ai_request_dispatched").t_ms,
    );
    assert.equal(
      engine.messages[1].first_received_t_ms,
      engine.events.find((e) => e.type === "ai_first_text_received").t_ms,
    );
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

test("TravelPlanner sessions save task-specific instructions and export the chosen task and complete reference packet", async () => {
  installBrowser();
  const previousFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (_, options) => {
    captured = JSON.parse(options.body);
    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(
            encode(
              'data: {"type":"delta","text":"Itinerary response"}\n\ndata: {"type":"completed"}\n\n',
            ),
          );
          c.close();
        },
      }),
    );
  };
  const engine = new SessionEngine("travel-test", travelConfig, () => {});
  try {
    await engine.start();
    await sleep(20);
    await engine.send("Help with the itinerary");
    assert.equal(captured.config_id, travelConfig.config_id);
    assert.deepEqual(Object.keys(captured).sort(), [
      "config_id",
      "messages",
      "request_id",
      "session_id",
    ]);
    assert.match(engine.session.instructions.task, /day-by-day itinerary/);
    assert.doesNotMatch(
      engine.session.instructions.task,
      /action sequence|initial state/,
    );
    await engine.finish("Participant's own itinerary");
    const files = unzipSync(await buildArchive(engine.snapshot));
    const saved = JSON.parse(strFromU8(files["session.json"]));
    const exportedTask = JSON.parse(strFromU8(files["task.json"]));
    assert.equal(saved.config.task.task_id, travelTask.task_id);
    assert.equal(exportedTask.source.row_index, 0);
    assert.deepEqual(
      exportedTask.reference_information,
      travelTask.reference_information,
    );
    assert.equal(saved.collection_status, "complete");
    assert.equal(
      strFromU8(files["final_answer.txt"]),
      "Participant's own itinerary",
    );
    assert.equal(
      engine.events.find((e) => e.type === "task_started").payload.task_id,
      travelTask.task_id,
    );
    assert.equal(
      (await loadSnapshot(engine.session.session_id)).session.config.task.kind,
      "travelplanner",
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (engine.session.status === "active") await engine.finish();
  }
});
