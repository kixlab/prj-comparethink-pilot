import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, createReadStream, statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import type {
  SttConfiguration,
  TranscriptCue,
  TranscriptionResult,
} from "../src/pilot/transcriptionTypes";

const MAX_UPLOAD = 64 * 1024 * 1024;
const MAX_DURATION_MS = 2 * 60 * 60 * 1000;
const API_PART_MS = 5 * 60 * 1000;
const execute = promisify(execFile);
export type RunCommand = (
  file: string,
  args: string[],
  signal: AbortSignal,
) => Promise<string>;
const runCommand: RunCommand = async (file, args, signal) => {
  const output = await execute(file, args, {
    signal,
    timeout: 15 * 60 * 1000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return output.stdout;
};
function executable(value: string) {
  const candidates = value.includes("/")
    ? [resolve(value)]
    : (process.env.PATH ?? "").split(delimiter).map((p) => join(p, value));
  return candidates.find((p) => {
    try {
      accessSync(p, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}
export interface SttSettings {
  configuration: SttConfiguration;
  ffmpeg: string;
  whisper: string;
  modelPath: string;
  modelSize: number;
  modelMtime: number;
  apiBase: string;
  apiKey: string;
}
export function makeSttSettings(
  env: Record<string, string | undefined>,
  root: string,
): SttSettings {
  const provider = env.STT_PROVIDER || "off";
  if (!["off", "local-whisper", "api"].includes(provider))
    throw new Error("Invalid STT_PROVIDER");
  const language = env.STT_LANGUAGE?.trim() || "auto";
  if (!/^(auto|[a-z]{2,3})$/.test(language))
    throw new Error("STT_LANGUAGE must be auto or a lowercase language code");
  const ffmpeg = executable(env.STT_FFMPEG_BIN || "ffmpeg") || "";
  const whisper =
    executable(
      env.STT_WHISPER_BIN ||
        join(root, ".local/stt/whisper.cpp/build/bin/whisper-cli"),
    ) || "";
  const modelPath = env.STT_WHISPER_MODEL ? resolve(env.STT_WHISPER_MODEL) : "";
  let modelSize = 0,
    modelMtime = 0;
  try {
    const info = statSync(modelPath);
    if (info.isFile()) {
      modelSize = info.size;
      modelMtime = info.mtimeMs;
    }
  } catch {
    /* unconfigured */
  }
  const format = env.STT_API_RESPONSE_FORMAT || "diarized_json";
  if (!["json", "verbose_json", "diarized_json"].includes(format))
    throw new Error("Invalid STT_API_RESPONSE_FORMAT");
  const url = new URL(env.STT_API_BASE_URL || "https://api.openai.com/v1");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "STT_API_BASE_URL must be a credential-free HTTPS base URL",
    );
  const apiBase = url.href.replace(/\/+$/, "");
  const apiKey = env.STT_API_KEY?.trim() || "";
  const model =
    provider === "local-whisper"
      ? basename(modelPath)
          .replace(/^ggml-/, "")
          .replace(/\.bin$/, "")
      : env.STT_API_MODEL?.trim() || "";
  const ready = Boolean(
    ffmpeg &&
    (provider === "local-whisper"
      ? whisper && modelSize
      : provider === "api"
        ? apiKey && model
        : false),
  );
  const publicFields = {
    provider: provider as SttConfiguration["provider"],
    model,
    language,
    remote_audio: provider === "api",
    preprocessing: {
      sample_rate_hz: 16000 as const,
      channels: 1 as const,
      pcm_bits: 16 as const,
      ...(provider === "api" ? { api_part_ms: API_PART_MS } : {}),
    },
    ...(provider === "api"
      ? {
          api_origin: url.origin,
          api_base_url: apiBase,
          response_format: format as SttConfiguration["response_format"],
        }
      : {}),
  };
  // Local paths and credentials never enter the browser configuration or exported results.
  const config_id = createHash("sha256")
    .update(
      JSON.stringify({
        ...publicFields,
        ffmpeg,
        whisper,
        modelPath,
        modelSize,
        modelMtime,
        ...(provider === "api" ? { apiBase } : {}),
      }),
    )
    .digest("hex");
  return {
    configuration: { ...publicFields, config_id, ready },
    ffmpeg,
    whisper,
    modelPath,
    modelSize,
    modelMtime,
    apiBase,
    apiKey,
  };
}

export function pcmFromWav(wav: Buffer) {
  if (
    wav.toString("ascii", 0, 4) !== "RIFF" ||
    wav.toString("ascii", 8, 12) !== "WAVE"
  )
    throw new Error("Audio conversion did not produce WAV");
  let pcm: Buffer | undefined,
    valid = false;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4),
      type = wav.toString("ascii", offset, offset + 4);
    if (size > wav.length - offset - 8)
      throw new Error("Truncated WAV conversion");
    if (type === "fmt " && size >= 16)
      valid =
        wav.readUInt16LE(offset + 8) === 1 &&
        wav.readUInt16LE(offset + 10) === 1 &&
        wav.readUInt32LE(offset + 12) === 16000 &&
        wav.readUInt16LE(offset + 22) === 16;
    if (type === "data") pcm = wav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  if (!valid || !pcm?.length)
    throw new Error("Expected non-empty 16 kHz mono PCM audio");
  return pcm;
}
export function wavFromPcm(pcm: Uint8Array) {
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, pcm]);
}
export function normalizeTranscript(
  raw: any,
  audioOffsetMs: number,
  recordingStartMs: number,
) {
  const local = Array.isArray(raw?.transcription);
  const entries: any[] = local
    ? raw.transcription
    : Array.isArray(raw?.segments)
      ? raw.segments
      : [];
  const cues: TranscriptCue[] = entries
    .map((entry) => {
      const from = local ? entry.offsets?.from : entry.start * 1000;
      const to = local ? entry.offsets?.to : entry.end * 1000;
      if (
        !Number.isFinite(from) ||
        !Number.isFinite(to) ||
        from < 0 ||
        to < from ||
        typeof entry.text !== "string"
      )
        throw new Error(
          "Transcription service returned invalid segment timestamps",
        );
      return {
        cue_id: randomUUID(),
        text: entry.text,
        audio_start_ms: audioOffsetMs + from,
        audio_end_ms: audioOffsetMs + to,
        start_t_ms: recordingStartMs + audioOffsetMs + from,
        end_t_ms: recordingStartMs + audioOffsetMs + to,
        ...(typeof entry.speaker === "string"
          ? { speaker: entry.speaker }
          : {}),
      };
    })
    .filter((cue) => cue.text.trim());
  // Text-only APIs remain usable, but no artificial speech boundaries are invented.
  return {
    cues,
    untimed_text:
      entries.length === 0 && typeof raw?.text === "string" ? raw.text : "",
    detected_language: local ? raw?.result?.language : raw?.language,
  };
}
const modelHashes = new Map<string, Promise<string>>();
async function modelHash(path: string, size: number, mtime: number) {
  const actual = statSync(path);
  if (actual.size !== size || actual.mtimeMs !== mtime)
    throw new Error("Local STT model changed; restart the server");
  const key = `${path}:${size}:${mtime}`;
  if (!modelHashes.has(key))
    modelHashes.set(
      key,
      (async () => {
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(path)) hash.update(chunk);
        return hash.digest("hex");
      })(),
    );
  return modelHashes.get(key)!;
}
export interface SttDependencies {
  run?: RunCommand;
  fetch?: typeof fetch;
  transcribe?: typeof transcribeRecording;
}
export async function transcribeRecording(
  settings: SttSettings,
  bytes: Buffer,
  startedMs: number,
  signal: AbortSignal,
  dependencies: SttDependencies = {},
): Promise<TranscriptionResult> {
  const run = dependencies.run || runCommand;
  const fetchApi = dependencies.fetch || fetch;
  const folder = await mkdtemp(join(tmpdir(), "comparethink-stt-"));
  try {
    const input = join(folder, "original-audio"),
      wav = join(folder, "audio.wav"),
      output = join(folder, "transcript");
    await writeFile(input, bytes, { mode: 0o600 });
    try {
      await run(
        settings.ffmpeg,
        [
          "-v",
          "error",
          "-nostdin",
          "-y",
          "-i",
          input,
          "-vn",
          "-map_metadata",
          "-1",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          "-t",
          "7200.1",
          wav,
        ],
        signal,
      );
    } catch {
      if (signal.aborted) throw new Error("Transcription interrupted");
      throw new Error("Could not decode the recording for transcription");
    }
    const pcm = pcmFromWav(await readFile(wav));
    const duration_ms = pcm.length / 32;
    if (duration_ms > MAX_DURATION_MS)
      throw new Error(
        "Recordings longer than two hours are not supported by this STT worker",
      );
    if (settings.configuration.provider === "local-whisper") {
      const model_sha256 = await modelHash(
        settings.modelPath,
        settings.modelSize,
        settings.modelMtime,
      );
      let engine_version = "unknown";
      try {
        engine_version = (await run(settings.whisper, ["--version"], signal))
          .trim()
          .slice(0, 200);
      } catch {
        /* model hash remains available */
      }
      try {
        await run(
          settings.whisper,
          [
            "-m",
            settings.modelPath,
            "-f",
            wav,
            "-l",
            settings.configuration.language,
            "-oj",
            "-of",
            output,
            "-np",
          ],
          signal,
        );
      } catch {
        if (signal.aborted) throw new Error("Transcription interrupted");
        throw new Error("Local Whisper could not transcribe this recording");
      }
      const raw = JSON.parse(await readFile(output + ".json", "utf8"));
      const parsed = normalizeTranscript(raw, 0, startedMs);
      return {
        status: "completed",
        ...parsed,
        duration_ms,
        warnings: [],
        model_sha256,
        engine_version,
        raw_result: { transcription: raw.transcription, result: raw.result },
      };
    }
    const cues: TranscriptCue[] = [],
      untimed: string[] = [],
      rawParts: unknown[] = [],
      warnings: string[] = [];
    let detected_language: string | undefined;
    for (let from = 0; from < pcm.length; from += API_PART_MS * 32) {
      try {
        if (signal.aborted) throw new Error("Transcription interrupted");
        const part = wavFromPcm(
          pcm.subarray(from, Math.min(from + API_PART_MS * 32, pcm.length)),
        );
        const form = new FormData();
        form.append(
          "file",
          new Blob([new Uint8Array(part)], { type: "audio/wav" }),
          "recording.wav",
        );
        form.append("model", settings.configuration.model);
        form.append("response_format", settings.configuration.response_format!);
        if (settings.configuration.language !== "auto")
          form.append("language", settings.configuration.language);
        if (settings.configuration.response_format === "verbose_json")
          form.append("timestamp_granularities[]", "segment");
        if (settings.configuration.response_format === "diarized_json")
          form.append("chunking_strategy", "auto");
        const response = await fetchApi(
          settings.apiBase + "/audio/transcriptions",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${settings.apiKey}` },
            body: form,
            signal,
            redirect: "error",
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`Transcription API returned HTTP ${response.status}`);
        }
        const raw = await response.json();
        const parsed = normalizeTranscript(raw, from / 32, startedMs);
        cues.push(...parsed.cues);
        if (parsed.untimed_text) untimed.push(parsed.untimed_text);
        if (typeof parsed.detected_language === "string")
          detected_language = parsed.detected_language;
        rawParts.push({ audio_offset_ms: from / 32, response: raw });
      } catch (error) {
        if (!rawParts.length) throw error;
        return {
          status: "partial",
          cues,
          untimed_text: untimed.join("\n"),
          detected_language,
          duration_ms,
          warnings: [
            "Only completed API parts are included. Earlier results are retained.",
          ],
          error: signal.aborted
            ? "Transcription interrupted"
            : "A transcription API part failed",
          raw_result: rawParts,
        };
      }
    }
    if (untimed.length)
      warnings.push(
        "This API returned text without speech timestamps. Untimed text is not aligned to individual events.",
      );
    return {
      status: "completed",
      cues,
      untimed_text: untimed.join("\n"),
      detected_language,
      duration_ms,
      warnings,
      raw_result: rawParts,
    };
  } finally {
    await rm(folder, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
export function sttPlugin(
  env: Record<string, string | undefined>,
  root: string,
  dependencies: SttDependencies = {},
): Plugin {
  const settings = makeSttSettings(env, root);
  let busy = false;
  const transcribe =
    dependencies.transcribe ||
    ((s, b, t, signal) => transcribeRecording(s, b, t, signal, dependencies));
  const install = (server: {
    middlewares: { use: (handler: any) => void };
  }) => {
    server.middlewares.use(
      async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!["/api/stt/config", "/api/stt/transcribe"].includes(url.pathname))
          return next();
        if (
          req.headers.origin &&
          req.headers.origin !==
            (env.PILOT_PUBLIC_ORIGIN ||
              `${(req.socket as any).encrypted ? "https" : "http"}://${req.headers.host}`)
        )
          return json(res, 403, {
            error: "Cross-origin requests are disabled",
          });
        if (url.pathname === "/api/stt/config")
          return req.method === "GET"
            ? json(res, 200, settings.configuration)
            : json(res, 405, { error: "GET only" });
        if (req.method !== "POST")
          return json(res, 405, { error: "POST only" });
        if (!settings.configuration.ready)
          return json(res, 503, {
            error: "Transcription is not configured on the server",
          });
        if (
          url.searchParams.get("config_id") !== settings.configuration.config_id
        )
          return json(res, 409, {
            error:
              "STT configuration changed. Reload the review before transcribing.",
          });
        for (const name of ["session_id", "segment_id"])
          if (!/^[A-Za-z0-9_-]{1,128}$/.test(url.searchParams.get(name) ?? ""))
            return json(res, 400, { error: "Invalid session or recording ID" });
        const started = Number(url.searchParams.get("started_t_ms"));
        if (
          !url.searchParams.has("started_t_ms") ||
          !Number.isFinite(started) ||
          started < 0
        )
          return json(res, 400, { error: "Invalid recording start time" });
        if (!/^[a-f0-9]{64}$/.test(url.searchParams.get("sha256") ?? ""))
          return json(res, 400, { error: "Missing recording checksum" });
        if (busy)
          return json(res, 429, {
            error:
              "The STT worker is busy. Retry after the current transcription finishes.",
          });
        busy = true;
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), 15 * 60 * 1000);
        res.on("close", () => controller.abort());
        req.on("aborted", () => controller.abort());
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += bytes.length;
            if (size > MAX_UPLOAD)
              return json(res, 413, {
                error: "Recording exceeds the 64 MiB STT upload limit",
              });
            chunks.push(bytes);
          }
          if (!size) return json(res, 400, { error: "Recording is empty" });
          const bytes = Buffer.concat(chunks);
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          if (sha256 !== url.searchParams.get("sha256"))
            return json(res, 400, { error: "Recording checksum mismatch" });
          const result = await transcribe(
            settings,
            bytes,
            started,
            controller.signal,
          );
          if (!res.destroyed)
            json(res, 200, {
              configuration: settings.configuration,
              sha256,
              result,
            });
        } catch (error) {
          if (!res.destroyed)
            json(res, controller.signal.aborted ? 408 : 502, {
              error: controller.signal.aborted
                ? "Transcription interrupted or timed out"
                : error instanceof Error
                  ? error.message
                  : "Transcription failed",
            });
        } finally {
          busy = false;
          clearTimeout(deadline);
        }
      },
    );
  };
  return {
    name: "comparethink-stt",
    configureServer: install,
    configurePreviewServer: install,
  };
}
