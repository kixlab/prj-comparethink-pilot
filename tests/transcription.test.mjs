import { test, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unzipSync, strFromU8 } from "fflate";
import "fake-indexeddb/auto";
import { loadTsBundle } from "../scripts/loadTsBundle.mjs";

// An actual v1 database must survive the additive v2 upgrade.
await new Promise((resolve, reject) => {
  const request = indexedDB.open("comparethink-pilot-v1", 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    db.createObjectStore("sessions", { keyPath: "session_id" });
    db.createObjectStore("events", { keyPath: ["session_id", "sequence"] });
    db.createObjectStore("audio", { keyPath: "chunk_id" }).createIndex(
      "session_id",
      "session_id",
    );
    request.transaction
      .objectStore("sessions")
      .add({ session_id: "legacy", clock: { origin_utc: "2026-01-01" } });
    request.transaction.objectStore("events").add({
      session_id: "legacy",
      sequence: 1,
      event_id: "original",
      type: "prompt_sent",
      payload: { text: "Original prompt" },
    });
    request.transaction.objectStore("audio").add({
      chunk_id: "original-audio",
      session_id: "legacy",
      segment_id: "segment",
      size: 2,
      index: 0,
      blob: new Blob([Uint8Array.of(1, 2)]),
    });
  };
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    request.result.close();
    resolve();
  };
});
const storage = await loadTsBundle("src/pilot/storage.ts", "node");
const {
  makeSttSettings,
  normalizeTranscript,
  transcribeRecording,
  wavFromPcm,
  sttPlugin,
} = await loadTsBundle("server/sttPlugin.ts", "node");
const { buildArchive } = await loadTsBundle("src/pilot/export.ts", "node");
const { displayTranscriptions } = await loadTsBundle(
  "src/pilot/transcriptionTypes.ts",
  "node",
);
const root = await mkdtemp(join(tmpdir(), "comparethink-stt-test-"));
after(async () => {
  (await storage.openDatabase()).close();
  await rm(root, { recursive: true, force: true });
});
const env = {
  STT_PROVIDER: "api",
  STT_API_BASE_URL: "https://stt.example/v1",
  STT_API_KEY: "stt-only-test-key",
  STT_API_MODEL: "timed-model",
  STT_API_RESPONSE_FORMAT: "verbose_json",
  STT_LANGUAGE: "ko",
  STT_FFMPEG_BIN: process.execPath,
};
const settings = makeSttSettings(env, root);
const source = {
  started_t_ms: 1000,
  mime_type: "audio/webm;codecs=opus",
  bytes: 2,
  sha256: "a".repeat(64),
};
const entry = (status, attempt = "attempt-1") => ({
  schema_version: "comparethink-transcription-v1",
  entry_id: crypto.randomUUID(),
  attempt_id: attempt,
  session_id: "legacy",
  segment_id: "segment",
  created_at_utc: new Date().toISOString(),
  status,
  configuration: settings.configuration,
  source,
  ...(status === "completed"
    ? {
        result: {
          status: "completed",
          duration_ms: 2000,
          cues: [
            {
              cue_id: "cue-1",
              text: "생각을 말합니다.",
              audio_start_ms: 200,
              audio_end_ms: 700,
              start_t_ms: 1200,
              end_t_ms: 1700,
            },
          ],
          untimed_text: "",
          warnings: [],
          raw_result: {},
        },
      }
    : {}),
});

test("v1 upgrade keeps original sessions, events and audio; transcript retries append immutable attempts", async () => {
  const original = await storage.loadSnapshot("legacy");
  assert.equal(original.events[0].event_id, "original");
  assert.deepEqual(
    [...new Uint8Array(await original.audio[0].blob.arrayBuffer())],
    [1, 2],
  );
  const started = entry("started"),
    complete = entry("completed"),
    failure = entry("failed", "attempt-2");
  await storage.saveTranscription(started);
  await storage.saveTranscription(complete);
  await storage.saveTranscription(failure);
  const saved = await storage.loadSnapshot("legacy");
  assert.equal(saved.transcriptions.length, 3);
  assert.equal(
    displayTranscriptions(saved.transcriptions)[0].entry_id,
    complete.entry_id,
  );
  assert.equal(saved.events[0].event_id, "original");
  await assert.rejects(
    storage.saveTranscription({ ...complete, error: "overwrite" }),
    /immutable/,
  );
  const db = await storage.openDatabase(),
    originalTransaction = db.transaction;
  db.transaction = () => {
    throw new Error("Injected quota failure");
  };
  const unsaved = entry("interrupted", "attempt-3");
  await assert.rejects(storage.saveTranscription(unsaved), /quota/);
  assert.deepEqual(storage.unsavedTranscriptionIds("legacy"), [
    unsaved.entry_id,
  ]);
  assert.equal((await storage.loadTranscriptions("legacy")).length, 4);
  db.transaction = originalTransaction;
  await storage.retryTranscriptionWrites("legacy");
  assert.equal(storage.unsavedTranscriptionIds("legacy").length, 0);
  assert.equal((await storage.loadTranscriptions("legacy")).length, 4);
});
test("STT configuration is independent from chat credentials and fingerprints routing, model, format and language", () => {
  assert.equal(settings.configuration.ready, true);
  assert.equal(settings.configuration.remote_audio, true);
  assert.equal(
    makeSttSettings(
      { ...env, STT_API_KEY: "", OPENAI_API_KEY: "bedrock-key" },
      root,
    ).configuration.ready,
    false,
  );
  assert.doesNotMatch(
    JSON.stringify(settings.configuration),
    /stt-only-test-key|modelPath|ffmpeg/,
  );
  assert.equal(
    settings.configuration.config_id,
    makeSttSettings({ ...env, STT_API_KEY: "rotated" }, root).configuration
      .config_id,
  );
  for (const change of [
    { STT_LANGUAGE: "en" },
    { STT_API_MODEL: "other" },
    { STT_API_BASE_URL: "https://other.example/v1" },
    { STT_API_RESPONSE_FORMAT: "diarized_json" },
  ])
    assert.notEqual(
      settings.configuration.config_id,
      makeSttSettings({ ...env, ...change }, root).configuration.config_id,
    );
});
test("local and API timestamps share the recording clock; untimed text gets no invented speech intervals", () => {
  const local = normalizeTranscript(
    {
      transcription: [{ offsets: { from: 150, to: 800 }, text: "한국어 발화" }],
      result: { language: "ko" },
    },
    0,
    5000,
  );
  assert.equal(local.cues[0].start_t_ms, 5150);
  const remote = normalizeTranscript(
    { segments: [{ start: 0.2, end: 0.9, text: "Speech", speaker: "A" }] },
    300000,
    5000,
  );
  assert.equal(remote.cues[0].start_t_ms, 305200);
  assert.equal(remote.cues[0].audio_end_ms, 300900);
  assert.equal(remote.cues[0].speaker, "A");
  const untimed = normalizeTranscript({ text: "Only text" }, 0, 0);
  assert.deepEqual(untimed.cues, []);
  assert.equal(untimed.untimed_text, "Only text");
  assert.throws(
    () =>
      normalizeTranscript(
        { segments: [{ start: NaN, end: 1, text: "bad" }] },
        0,
        0,
      ),
    /timestamps/,
  );
});
test("API adapter uploads audio only with its own key, keeps chunk offsets and partial results, and removes processing files", async () => {
  const folders = [],
    calls = [];
  const run = async (_, args) => {
    folders.push(args.at(-1));
    await writeFile(args.at(-1), wavFromPcm(Buffer.alloc(301 * 32000)));
    return "";
  };
  const fetchApi = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers.Authorization, "Bearer stt-only-test-key");
    assert.deepEqual([...options.body.keys()].sort(), [
      "file",
      "language",
      "model",
      "response_format",
      "timestamp_granularities[]",
    ]);
    assert.equal(options.body.get("file").type, "audio/wav");
    return Response.json({
      segments: [
        { start: 0.2, end: 0.8, text: calls.length === 1 ? "first" : "second" },
      ],
    });
  };
  const result = await transcribeRecording(
    settings,
    Buffer.from("original compressed recording"),
    5000,
    new AbortController().signal,
    { run, fetch: fetchApi },
  );
  assert.equal(calls.length, 2);
  assert.equal(result.status, "completed");
  assert.equal(result.cues[0].start_t_ms, 5200);
  assert.equal(result.cues[1].start_t_ms, 305200);
  await assert.rejects(readFile(folders[0]), /ENOENT/);
  let part = 0;
  const partial = await transcribeRecording(
    settings,
    Buffer.from("original"),
    5000,
    new AbortController().signal,
    {
      run,
      fetch: async () =>
        ++part === 1
          ? Response.json({
              segments: [{ start: 0, end: 1, text: "retained" }],
            })
          : new Response("Unavailable", { status: 503 }),
    },
  );
  assert.equal(partial.status, "partial");
  assert.equal(partial.cues[0].text, "retained");
});
test("local adapter reads an existing model without changing it and retains estimated speech intervals", async () => {
  const modelPath = join(root, "ggml-test.bin");
  await writeFile(modelPath, "read-only-test-model");
  const local = makeSttSettings(
    {
      STT_PROVIDER: "local-whisper",
      STT_WHISPER_BIN: process.execPath,
      STT_WHISPER_MODEL: modelPath,
      STT_FFMPEG_BIN: process.execPath,
    },
    root,
  );
  const run = async (file, args) => {
    if (args.includes("--version")) return "fixture-runner";
    if (args.includes("-of"))
      await writeFile(
        args[args.indexOf("-of") + 1] + ".json",
        JSON.stringify({
          transcription: [
            { offsets: { from: 100, to: 600 }, text: "실제 형식" },
          ],
          result: { language: "ko" },
        }),
      );
    else await writeFile(args.at(-1), wavFromPcm(Buffer.alloc(32000)));
    return "";
  };
  const result = await transcribeRecording(
    local,
    Buffer.from("compressed"),
    1000,
    new AbortController().signal,
    { run },
  );
  assert.equal(
    result.model_sha256,
    createHash("sha256").update("read-only-test-model").digest("hex"),
  );
  assert.equal(result.cues[0].start_t_ms, 1100);
  assert.equal(result.engine_version, "fixture-runner");
  assert.equal(await readFile(modelPath, "utf8"), "read-only-test-model");
});
test("server rejects stale configuration and audio checksum mismatch before transcription", async () => {
  let handler,
    calls = 0;
  const plugin = sttPlugin(env, root, {
    transcribe: async () => {
      calls++;
      return {
        status: "completed",
        cues: [],
        untimed_text: "",
        warnings: [],
        duration_ms: 1000,
        raw_result: {},
      };
    },
  });
  plugin.configureServer({
    middlewares: {
      use(fn) {
        handler = fn;
      },
    },
  });
  const bytes = Buffer.from("original"),
    checksum = createHash("sha256").update(bytes).digest("hex");
  const invoke = async (configId, hash) => {
    const req = Object.assign(new EventEmitter(), {
      method: "POST",
      url: `/api/stt/transcribe?session_id=s&segment_id=a&started_t_ms=1000&sha256=${hash}&config_id=${configId}`,
      headers: { host: "localhost" },
      socket: {},
      async *[Symbol.asyncIterator]() {
        yield bytes;
      },
    });
    const res = new EventEmitter();
    res.destroyed = false;
    res.writeHead = (status) => {
      res.status = status;
    };
    res.end = (body) => {
      res.body = JSON.parse(body);
    };
    await handler(req, res, () => assert.fail("middleware fallthrough"));
    return res;
  };
  assert.equal((await invoke("stale", checksum)).status, 409);
  assert.equal(
    (await invoke(settings.configuration.config_id, "b".repeat(64))).status,
    400,
  );
  assert.equal(calls, 0);
  assert.equal(
    (await invoke(settings.configuration.config_id, checksum)).status,
    200,
  );
  assert.equal(calls, 1);
});
test("export adds all transcript attempts and time-aligned VTT without modifying original events, chat or audio", async () => {
  const original = await storage.loadSnapshot("legacy");
  const session = {
    ...original.session,
    status: "completed",
    collection_status: "complete",
    config: { task: {} },
    issues: [],
    gaps: [],
    last_t_ms: 2000,
    audio_segments: [
      {
        segment_id: "segment",
        started_t_ms: 1000,
        ended_t_ms: 2000,
        mime_type: "audio/webm",
      },
    ],
  };
  const files = unzipSync(await buildArchive({ ...original, session }));
  const transcripts = JSON.parse(strFromU8(files["transcriptions.json"]));
  assert.equal(transcripts.entries.length, 4);
  assert.match(
    strFromU8(files["transcript.vtt"]),
    /00:00:01\.200 --> 00:00:01\.700/,
  );
  assert.match(strFromU8(files["transcript.txt"]), /생각을 말합니다/);
  assert.deepEqual([...files["audio/segment-001.webm"]], [1, 2]);
  assert.match(strFromU8(files["events.jsonl"]), /Original prompt/);
  assert.doesNotMatch(strFromU8(files["messages.json"]), /생각을 말합니다/);
});

test("an unreadable STT store never blocks exporting already captured audio and events", async () => {
  const db = await storage.openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["sessions", "events", "audio"], "readwrite");
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
    tx.objectStore("sessions").add({
      session_id: "raw-export-safe",
      clock: { origin_utc: "2026-01-01" },
      status: "completed",
      collection_status: "complete",
      config: { task: {} },
      issues: [],
      gaps: [],
      last_t_ms: 2000,
      audio_segments: [
        {
          segment_id: "recording",
          started_t_ms: 0,
          ended_t_ms: 2000,
          mime_type: "audio/webm",
        },
      ],
    });
    tx.objectStore("events").add({
      session_id: "raw-export-safe",
      sequence: 1,
      event_id: "safe-original",
      type: "task_started",
      payload: {},
    });
    tx.objectStore("audio").add({
      chunk_id: "safe-audio",
      session_id: "raw-export-safe",
      segment_id: "recording",
      index: 0,
      size: 2,
      blob: new Blob([Uint8Array.of(3, 4)]),
    });
  });
  const transaction = db.transaction;
  db.transaction = function (...args) {
    if (args[0] === "transcriptions")
      throw new Error("Injected transcript read failure");
    return transaction.apply(this, args);
  };
  try {
    const snapshot = await storage.loadSnapshot("raw-export-safe");
    assert.match(snapshot.transcription_read_error, /read failure/);
    assert.equal(snapshot.events[0].event_id, "safe-original");
    const files = unzipSync(await buildArchive(snapshot));
    assert.deepEqual([...files["audio/segment-001.webm"]], [3, 4]);
    assert.match(
      JSON.parse(strFromU8(files["transcriptions.json"])).read_error,
      /read failure/,
    );
  } finally {
    db.transaction = transaction;
  }
});
