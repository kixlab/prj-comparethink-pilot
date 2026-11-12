import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { loadTsBundle } from "../scripts/loadTsBundle.mjs";
const { encodeFrames, decodeFrames } = await loadTsBundle(
  "src/pilot/syncFormat.ts",
  "node",
);
const { syncPlugin } = await loadTsBundle("server/syncPlugin.ts", "node");
const { MemorySyncStore } = await loadTsBundle("server/syncStore.ts", "node");
const { AutoTranscriber } = await loadTsBundle(
  "server/autoTranscribe.ts",
  "node",
);
const { makeSttSettings } = await loadTsBundle("server/sttPlugin.ts", "node");
const { SyncManager, listServerSessions, loadServerSnapshot } =
  await loadTsBundle("src/pilot/sync.ts", "node");
const { Journal } = await loadTsBundle("src/pilot/storage.ts", "node");
const { buildArchive } = await loadTsBundle("src/pilot/export.ts", "node");

/** fetch() routed straight into the plugin middleware, as the browser would call it. */
function shim(plugin, extraHeaders = {}, fail = () => false) {
  let handler;
  plugin.configureServer({
    middlewares: {
      use(fn) {
        handler = fn;
      },
    },
  });
  const calls = [];
  const fetcher = async (input, init = {}) => {
    calls.push(input);
    if (fail(input)) throw new TypeError("Failed to fetch");
    const body =
      init.body === undefined
        ? new Uint8Array()
        : init.body instanceof Blob
          ? new Uint8Array(await init.body.arrayBuffer())
          : new TextEncoder().encode(init.body);
    const headers = { host: "localhost", ...extraHeaders };
    new Headers(init.headers).forEach((value, key) => (headers[key] = value));
    const req = {
      method: init.method ?? "GET",
      url: input,
      headers,
      socket: {},
      async *[Symbol.asyncIterator]() {
        if (body.byteLength) yield Buffer.from(body);
      },
    };
    let status = 200;
    let responseHeaders = {};
    const out = [];
    const res = {
      headersSent: false,
      writeHead(s, h = {}) {
        status = s;
        responseHeaders = Object.fromEntries(
          Object.entries(h).map(([k, v]) => [k, String(v)]),
        );
        this.headersSent = true;
      },
      end(b) {
        if (b) out.push(Buffer.from(b));
      },
    };
    let fellThrough = false;
    await handler(req, res, () => (fellThrough = true));
    if (fellThrough) return new Response("not found", { status: 404 });
    return new Response(Buffer.concat(out), {
      status,
      headers: responseHeaders,
    });
  };
  fetcher.calls = calls;
  return fetcher;
}

function makeSession(id, lastSequence) {
  return {
    schema_version: "comparethink-session-v1",
    session_id: id,
    participant_id: "p-sync",
    ui_language: "ko",
    config: {
      config_id: "cfg",
      task: { task_id: "t", title: "Blocksworld", language: "ko" },
      model: "m",
      provider: "openai-responses",
      generation: { max_output_tokens: 10 },
      system_prompt: "x",
      app_version: "test",
      app_commit: "test",
      api_ready: true,
    },
    instructions: { task: "", think_aloud: "", audio_notice: "" },
    clock: {
      origin_utc: "2026-11-11T00:00:00.000Z",
      performance_time_origin_ms: 0,
      start_performance_ms: 0,
      unit: "ms",
      method: "test",
    },
    status: "completed",
    collection_status: "complete",
    issues: [],
    gaps: [],
    audio_segments: [
      {
        segment_id: "seg-1",
        started_t_ms: 0,
        start_call_t_ms: 0,
        ended_t_ms: 5000,
        mime_type: "audio/webm",
        track_settings: {},
      },
    ],
    last_sequence: lastSequence,
    last_t_ms: lastSequence * 10,
    environment: { user_agent: "test", language: "ko", audio_constraints: {} },
  };
}

async function seed(id, eventCount, chunkCount) {
  const journal = new Journal(
    () => {},
    (e) => {
      throw e;
    },
  );
  const session = makeSession(id, eventCount - 1);
  journal.enqueue({ session, create: true });
  for (let sequence = 0; sequence < eventCount; sequence++)
    journal.enqueue({
      session,
      event: {
        event_id: `${id}-e${sequence}`,
        session_id: id,
        sequence,
        t_ms: sequence * 10,
        type: sequence === 0 ? "session_started" : "heartbeat",
        payload: { n: sequence, 한글: "그대로" },
      },
    });
  for (let index = 0; index < chunkCount; index++)
    journal.enqueue({
      session,
      audio: {
        chunk_id: `${id}-c${index}`,
        session_id: id,
        segment_id: "seg-1",
        index,
        received_t_ms: index * 1000,
        recorder_timecode_ms: index * 1000,
        size: 3 + index,
        mime_type: "audio/webm",
        blob: new Blob([new Uint8Array(3 + index).fill(index + 1)], {
          type: "audio/webm",
        }),
      },
    });
  assert.equal(await journal.flush(), true);
  return session;
}

test("audio frames round-trip bytes and metadata and reject truncated bodies", () => {
  const meta = (i) => ({
    chunk_id: `c${i}`,
    session_id: "s",
    segment_id: "seg",
    index: i,
    received_t_ms: i,
    recorder_timecode_ms: null,
    size: i,
    mime_type: "audio/webm",
    byte_length: 0,
  });
  const body = encodeFrames([
    { meta: meta(0), bytes: new Uint8Array([]) },
    { meta: meta(1), bytes: new Uint8Array([7]) },
    { meta: meta(2), bytes: new Uint8Array([8, 9]) },
  ]);
  const decoded = decodeFrames(body);
  assert.deepEqual(
    decoded.map((d) => [d.meta.chunk_id, d.meta.byte_length, [...d.bytes]]),
    [
      ["c0", 0, []],
      ["c1", 1, [7]],
      ["c2", 2, [8, 9]],
    ],
  );
  assert.throws(
    () => decodeFrames(body.subarray(0, body.byteLength - 1)),
    /Truncated/,
  );
  assert.throws(() => decodeFrames(new Uint8Array([0, 0])), /Truncated/);
});

test("sessions upload incrementally, resume after a network failure, never duplicate, and download back intact", async () => {
  const store = new MemorySyncStore();
  const id = "sync-session-1";
  await seed(id, 1200, 25);

  // First pass: the network drops on the first audio upload.
  let dropAudio = true;
  const flaky = shim(syncPlugin({}, process.cwd(), store), {}, (url) => {
    if (dropAudio && url.startsWith("/api/sync/audio")) {
      dropAudio = false;
      return true;
    }
    return false;
  });
  const first = new SyncManager(() => {}, flaky);
  first.enabled = true;
  const failed = await first.sync(id);
  assert.equal(failed.status, "error");
  assert.match(failed.error, /Failed to fetch/);
  assert.equal(failed.pending, 25, "all audio still pending");
  assert.equal(store.events.size, 1200, "events reached the server first");

  // Retry continues from where it stopped.
  const resumed = await first.sync(id);
  assert.equal(resumed.status, "synced");
  assert.equal(resumed.pending, 0);
  assert.equal(store.audio.size, 25);

  // A new page load (fresh manager) asks the server what it has and uploads nothing again.
  const fetcher = shim(syncPlugin({}, process.cwd(), store));
  const second = new SyncManager(() => {}, fetcher);
  assert.equal(await second.start(), true);
  second.stop();
  await second.sync(id);
  const uploads = fetcher.calls.filter(
    (u) =>
      u.startsWith("/api/sync/events") ||
      u.startsWith("/api/sync/audio") ||
      u.startsWith("/api/sync/transcriptions"),
  );
  assert.deepEqual(uploads, []);
  assert.equal(store.events.size, 1200);
  assert.equal(store.audio.size, 25);

  // New local data after the last pass is picked up on the next pass.
  const journal = new Journal(
    () => {},
    () => {},
  );
  const later = makeSession(id, 1205);
  later.status = "completed";
  journal.enqueue({
    session: later,
    event: {
      event_id: `${id}-late`,
      session_id: id,
      sequence: 1205,
      t_ms: 99999,
      type: "session_ended",
      payload: {},
    },
  });
  await journal.flush();
  const next = await second.sync(id);
  assert.equal(next.status, "synced");
  assert.ok(store.events.has(`${id}:1205`));
  assert.equal(store.sessions.get(id).last_sequence, 1205);

  // Researcher download: the server copy rebuilds the same snapshot and a ZIP.
  const admin = shim(syncPlugin({}, process.cwd(), store));
  const [summary] = await listServerSessions(admin);
  assert.equal(summary.session_id, id);
  assert.equal(summary.event_count, store.events.size);
  assert.equal(summary.audio_chunk_count, 25);
  const snapshot = await loadServerSnapshot(id, admin);
  assert.equal(snapshot.events.length, store.events.size);
  assert.deepEqual(
    snapshot.events.slice(0, 3).map((e) => e.sequence),
    [0, 1, 2],
  );
  assert.equal(snapshot.events[1].payload.한글, "그대로");
  assert.equal(snapshot.audio.length, 25);
  assert.deepEqual(
    [...new Uint8Array(await snapshot.audio[2].blob.arrayBuffer())],
    [3, 3, 3, 3, 3],
  );
  assert.equal(snapshot.audio[2].blob.type, "audio/webm");
  assert.ok((await buildArchive(snapshot)).byteLength > 1000);
});

test("an older session snapshot never replaces a newer one, and records stay add-only", async () => {
  const store = new MemorySyncStore();
  const post = shim(syncPlugin({}, process.cwd(), store));
  const send = (session) =>
    post("/api/sync/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session }),
    }).then((r) => r.json());
  assert.equal((await send(makeSession("s2", 10))).result, "stored");
  assert.equal((await send(makeSession("s2", 4))).result, "stale");
  assert.equal(store.sessions.get("s2").last_sequence, 10);
  const event = {
    event_id: "e",
    session_id: "s2",
    sequence: 0,
    t_ms: 0,
    type: "x",
    payload: {},
  };
  const addEvents = (events) =>
    post("/api/sync/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "s2", events }),
    });
  assert.equal((await (await addEvents([event])).json()).added, 1);
  assert.equal(
    (await (await addEvents([{ ...event, type: "changed" }])).json()).added,
    0,
  );
  assert.equal(store.events.get("s2:0").type, "x");
  // An event for a different session is rejected.
  assert.equal(
    (await addEvents([{ ...event, session_id: "other" }])).status,
    400,
  );
  // Path traversal in identifiers is rejected before touching storage.
  assert.equal(
    (await post("/api/sync/status?session_id=../../etc", {})).status,
    400,
  );
});

test("storage endpoints follow the access keys: participants upload, only admin keys read back", async () => {
  const store = new MemorySyncStore();
  const env = {
    PILOT_ACCESS_TOKENS: "participant-key-0123456789",
    PILOT_ADMIN_TOKENS: "researcher-admin-key-012345",
  };
  const as = (key) =>
    shim(
      syncPlugin(env, process.cwd(), store),
      key ? { "x-pilot-access": key } : {},
    );
  assert.equal((await as()("/api/sync/config")).status, 401);
  assert.equal(
    (await as("participant-key-0123456789")("/api/sync/config")).status,
    200,
  );
  const participantList = await as("participant-key-0123456789")(
    "/api/admin/sessions",
  );
  assert.equal(participantList.status, 403);
  await assert.rejects(
    listServerSessions(as("participant-key-0123456789")),
    /admin link/,
  );
  assert.equal(
    (await as("researcher-admin-key-012345")("/api/admin/sessions")).status,
    200,
  );
  // Without a configured store the uploader stays off and endpoints report it.
  const off = shim(syncPlugin({}, process.cwd(), null));
  assert.deepEqual(await (await off("/api/sync/config")).json(), {
    enabled: false,
    auto_transcribe: false,
  });
  assert.equal((await off("/api/sync/status?session_id=x")).status, 503);
  const manager = new SyncManager(() => {}, off);
  assert.equal(await manager.start(), false);
});

// STT "ready" only needs an executable for ffmpeg; the transcription itself is faked.
const sttEnv = {
  STT_PROVIDER: "api",
  STT_API_KEY: "test-key",
  STT_API_MODEL: "whisper-1",
  STT_API_RESPONSE_FORMAT: "verbose_json",
  STT_FFMPEG_BIN: "/bin/sh",
};
const quiet = { log() {}, error() {} };
const fakeResult = (text) => ({
  status: "completed",
  cues: [
    {
      cue_id: "cue-1",
      text,
      audio_start_ms: 0,
      audio_end_ms: 500,
      start_t_ms: 0,
      end_t_ms: 500,
    },
  ],
  untimed_text: "",
  warnings: [],
  duration_ms: 1000,
  raw_result: null,
});
async function storeWithSession(id, { status = "completed", chunks = 2 } = {}) {
  const store = new MemorySyncStore();
  const session = { ...makeSession(id, chunks), status };
  await store.putSession(session);
  await store.addEvents(id, [
    {
      event_id: `${id}-e0`,
      session_id: id,
      sequence: 0,
      t_ms: 0,
      type: "session_created",
      payload: {},
    },
    ...Array.from({ length: chunks }, (_, index) => ({
      event_id: `${id}-a${index}`,
      session_id: id,
      sequence: index + 1,
      t_ms: index * 1000,
      type: "audio_chunk_received",
      payload: { chunk_id: `${id}-c${index}`, segment_id: "seg-1", index },
    })),
  ]);
  const addChunk = (index) =>
    store.addAudio(id, [
      {
        meta: {
          chunk_id: `${id}-c${index}`,
          session_id: id,
          segment_id: "seg-1",
          index,
          received_t_ms: index * 1000,
          recorder_timecode_ms: index * 1000,
          size: 2,
          mime_type: "audio/webm",
          byte_length: 2,
        },
        bytes: new Uint8Array([index, index]),
      },
    ]);
  return { store, addChunk };
}

test("the server transcribes a finished upload by itself, waits for missing chunks, and retries failures", async () => {
  const id = "auto-1";
  const { store, addChunk } = await storeWithSession(id);
  const received = [];
  let failNext = true;
  const auto = new AutoTranscriber(store, makeSttSettings(sttEnv, "."), {
    log: quiet,
    transcribe: async (_settings, bytes, startedMs) => {
      received.push([...bytes]);
      assert.equal(startedMs, 0);
      if (failNext) {
        failNext = false;
        throw new Error("API down");
      }
      return fakeResult("안녕하세요");
    },
  });
  // Chunk 1 is announced by an event but not uploaded yet.
  await addChunk(0);
  assert.equal(await auto.enqueue(id), "waiting");
  assert.equal(received.length, 0);

  await addChunk(1);
  assert.equal(await auto.enqueue(id), "waiting", "first attempt fails");
  assert.deepEqual(received[0], [0, 0, 1, 1], "chunks joined in order");
  assert.equal(await auto.enqueue(id), "settled", "retry succeeds");
  assert.equal(await auto.enqueue(id), "settled");
  assert.equal(received.length, 2, "a completed segment is not redone");

  const records = [...store.transcriptions.values()];
  assert.deepEqual(
    records.map((r) => r.status),
    ["started", "failed", "started", "completed"],
  );
  assert.ok(records.every((r) => r.generated_by === "server"));
  const done = records.at(-1);
  assert.equal(done.result.cues[0].text, "안녕하세요");
  assert.equal(done.source.bytes, 4);
  assert.equal(done.configuration.model, "whisper-1");
  assert.equal(done.attempt_id, records[2].attempt_id);
  assert.notEqual(done.attempt_id, records[0].attempt_id);
});

test("automatic transcription gives up after the attempt limit and skips unfinished sessions until abandoned", async () => {
  const failing = await storeWithSession("auto-2");
  await failing.addChunk(0);
  await failing.addChunk(1);
  let calls = 0;
  const auto = new AutoTranscriber(
    failing.store,
    makeSttSettings(sttEnv, "."),
    {
      log: quiet,
      maxAttempts: 2,
      transcribe: async () => {
        calls++;
        throw new Error("still down");
      },
    },
  );
  for (let i = 0; i < 4; i++) await auto.enqueue("auto-2");
  assert.equal(calls, 2);

  const active = await storeWithSession("auto-3", { status: "active" });
  await active.addChunk(0);
  await active.addChunk(1);
  let activeCalls = 0;
  const auto2 = new AutoTranscriber(
    active.store,
    makeSttSettings(sttEnv, "."),
    {
      log: quiet,
      transcribe: async () => (activeCalls++, fakeResult("x")),
    },
  );
  assert.equal(await auto2.enqueue("auto-3"), "waiting");
  assert.equal(activeCalls, 0, "a running session is left alone");
  await auto2.enqueue("auto-3", true);
  assert.equal(activeCalls, 1, "an abandoned session is transcribed");
});

test("uploads through the sync endpoints trigger server transcription when STT is configured", async () => {
  const store = new MemorySyncStore();
  const id = "auto-upload";
  await seed(id, 5, 3);
  const texts = [];
  const plugin = syncPlugin(sttEnv, process.cwd(), store, {
    scan: false,
    delayMs: 0,
    log: quiet,
    transcribe: async (_s, bytes) => {
      texts.push(bytes.byteLength);
      return fakeResult("업로드 후 자동 전사");
    },
  });
  const fetcher = shim(plugin);
  assert.deepEqual(await (await fetcher("/api/sync/config")).json(), {
    enabled: true,
    auto_transcribe: true,
  });
  const manager = new SyncManager(() => {}, fetcher);
  assert.equal(await manager.start(), true);
  manager.stop();
  assert.equal(manager.autoTranscribe, true);
  assert.equal((await manager.sync(id)).status, "synced");
  for (let i = 0; i < 100 && store.transcriptions.size < 2; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(texts, [3 + 4 + 5]);
  const done = [...store.transcriptions.values()].find(
    (r) => r.status === "completed",
  );
  assert.equal(done.session_id, id);
  assert.equal(done.result.cues[0].text, "업로드 후 자동 전사");

  // STT_AUTO_TRANSCRIBE=off keeps the browser-only flow.
  const off = shim(
    syncPlugin({ ...sttEnv, STT_AUTO_TRANSCRIBE: "off" }, process.cwd(), store),
  );
  assert.equal(
    (await (await off("/api/sync/config")).json()).auto_transcribe,
    false,
  );
});
