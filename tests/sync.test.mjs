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
  });
  assert.equal((await off("/api/sync/status?session_id=x")).status, 503);
  const manager = new SyncManager(() => {}, off);
  assert.equal(await manager.start(), false);
});
