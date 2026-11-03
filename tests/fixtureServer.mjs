// Real Vite + server middleware, with only the external model transport replaced.
import { createServer } from "vite";
import { loadTsBundle } from "../scripts/loadTsBundle.mjs";
import { writeFileSync } from "node:fs";
const { pilotPlugin } = await loadTsBundle("server/pilotPlugin.ts", "node");
const requests = [];
const enc = new TextEncoder();
const upstream = async (_, options) => {
  const body = JSON.parse(options.body);
  requests.push(body);
  const prompt = body.input.at(-1).content;
  if (prompt.includes("FAIL_HTTP"))
    return new Response("fixture error", { status: 503 });
  const chunks = prompt.includes("FAIL_STREAM")
    ? ["Partial response retained."]
    : ["I have checked ", "the task rules ", "and current state."];
  let timer;
  return new Response(
    new ReadableStream({
      start(controller) {
        let closed = false;
        const send = (value) => {
          if (!closed)
            controller.enqueue(
              enc.encode(`data: ${JSON.stringify(value)}\n\n`),
            );
        };
        const close = () => {
          if (!closed) {
            closed = true;
            clearTimeout(timer);
            controller.close();
          }
        };
        options.signal.addEventListener("abort", close);
        send({
          type: "response.created",
          response: { id: "fixture-response", model: "fixture-model" },
        });
        let i = 0;
        const tick = () => {
          if (closed) return;
          if (i < chunks.length) {
            send({ type: "response.output_text.delta", delta: chunks[i++] });
            timer = setTimeout(
              tick,
              prompt.includes("SLOW_STREAM") ? 6000 : 400,
            );
          } else {
            if (!prompt.includes("DROP_STREAM"))
              send(
                prompt.includes("FAIL_STREAM")
                  ? {
                      type: "response.failed",
                      response: { error: { code: "fixture_midstream_error" } },
                    }
                  : {
                      type: "response.completed",
                      response: {
                        id: "fixture-response",
                        usage: { output_tokens: 10 },
                      },
                    },
              );
            close();
          }
        };
        timer = setTimeout(tick, 1100);
      },
      cancel() {
        clearTimeout(timer);
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
};
// A known continuous tone is injected through Chromium's real microphone capture pipeline.
const sampleRate = 48000,
  duration = 24,
  samples = sampleRate * duration;
const wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++)
  wav.writeInt16LE(
    Math.round(
      Math.sin(
        (i / sampleRate) *
          Math.PI *
          2 *
          (Math.floor(i / sampleRate) % 2 ? 440 : 660),
      ) * 9000,
    ),
    44 + i * 2,
  );
writeFileSync("/tmp/comparethink-test-mic.wav", wav);
const server = await createServer({
  configFile: false,
  plugins: [
    pilotPlugin(
      { OPENAI_API_KEY: "fixture-key", OPENAI_MODEL: "fixture-model" },
      "0.2.0-test",
      "browser-test",
      upstream,
    ),
    {
      name: "test-request-inspection",
      configureServer(server) {
        server.middlewares.use("/__test/requests", (_, res) => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(requests));
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port: 5185, strictPort: true },
});
await server.listen();
console.log("CompareThink browser fixture listening on http://127.0.0.1:5185");
