import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import {
  defaultTask,
  tasks,
  taskCatalog,
  taskContext,
} from "../tasks/registry";
import type { Task } from "../tasks/types";
import { readSse } from "../src/pilot/stream";
import type { Configuration } from "../src/pilot/types";

function connectionSettings(env: Record<string, string | undefined>) {
  const url = new URL(
    env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",
  );
  const path = url.pathname.replace(/\/+$/, "");
  const bedrock =
    /^bedrock-mantle\.[a-z0-9-]+\.api\.aws$/.test(url.hostname) ||
    /^bedrock-runtime\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !(bedrock
      ? ["/v1", "/openai/v1"].includes(path)
      : url.hostname === "api.openai.com" && path === "/v1")
  )
    throw new Error(
      "OPENAI_BASE_URL must be an official OpenAI or regional Amazon Bedrock HTTPS API base URL",
    );
  if (bedrock && !env.OPENAI_MODEL?.trim())
    throw new Error(
      "Set OPENAI_MODEL to the Bedrock model or inference profile ID for this endpoint",
    );
  const project = env.OPENAI_PROJECT?.trim();
  if (project && /[\r\n]/.test(project))
    throw new Error("Invalid OPENAI_PROJECT");
  return {
    provider: bedrock ? "bedrock-responses" : "openai-responses",
    api_base_url: `${url.origin}${path}`,
    ...(project ? { project } : {}),
  };
}
function apiKeyError(
  env: Record<string, string | undefined>,
  provider: string,
) {
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return "Server OPENAI_API_KEY is not configured";
  if (provider === "bedrock-responses" && key.startsWith("sk-"))
    return "Bedrock is configured, but OPENAI_API_KEY still looks like an OpenAI-hosted key. Set it to your Bedrock API key and restart the server.";
  if (provider === "openai-responses" && key.startsWith("ABSK"))
    return "OPENAI_API_KEY looks like a Bedrock API key. Set OPENAI_BASE_URL to your regional Bedrock endpoint and restart the server.";
  return null;
}

export function makeConfiguration(
  env: Record<string, string | undefined>,
  version: string,
  commit: string,
  task: Task = defaultTask,
): Configuration {
  const connection = connectionSettings(env);
  const maxTokens = Number(env.OPENAI_MAX_OUTPUT_TOKENS || 4096);
  if (!Number.isInteger(maxTokens) || maxTokens < 1)
    throw new Error("Invalid OPENAI_MAX_OUTPUT_TOKENS");
  const generation: Configuration["generation"] = {
    max_output_tokens: maxTokens,
  };
  if (env.OPENAI_TEMPERATURE) {
    const temperature = Number(env.OPENAI_TEMPERATURE);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)
      throw new Error("Invalid OPENAI_TEMPERATURE");
    generation.temperature = temperature;
  }
  if (env.OPENAI_REASONING_EFFORT)
    generation.reasoning = { effort: env.OPENAI_REASONING_EFFORT };
  const fixed = {
    task,
    ...connection,
    model: env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
    generation,
    system_prompt:
      "You are collaborating with a participant on the planning task provided below. Respond to their chat in their language. Use only the provided task and conversation. The participant chooses and submits their final answer. Do not claim that a response has been submitted. No reference solution is supplied.\n\n" +
      JSON.stringify(taskContext(task)),
    app_version: version,
    app_commit: commit,
  };
  return {
    ...fixed,
    config_id: createHash("sha256").update(JSON.stringify(fixed)).digest("hex"),
    api_ready: !apiKeyError(env, connection.provider),
  };
}
export function providerPayload(config: Configuration, messages: unknown) {
  if (!Array.isArray(messages) || !messages.length)
    throw new Error("Invalid messages");
  const chat = messages.map((m) => {
    if (
      !m ||
      typeof m !== "object" ||
      Object.keys(m).some((k) => !["role", "content"].includes(k)) ||
      !["user", "assistant"].includes(m.role) ||
      typeof m.content !== "string"
    )
      throw new Error("Only role/content chat messages are accepted");
    return { role: m.role, content: m.content };
  });
  if (chat.at(-1)?.role !== "user")
    throw new Error("The final message must be from the user");
  return {
    model: config.model,
    ...config.generation,
    store: false,
    stream: true,
    instructions: config.system_prompt,
    input: chat,
  };
}
async function readBody(req: IncomingMessage) {
  req.setEncoding("utf8");
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 2_000_000)
      throw new Error("Request too large");
  }
  return JSON.parse(body);
}
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}
// Dependency injection is used only by automated tests; no mock route or client-side API key exists.
export function pilotPlugin(
  env: Record<string, string | undefined>,
  version: string,
  commit: string,
  upstream: typeof fetch = fetch,
): Plugin {
  const configurations = tasks.map((task) =>
    makeConfiguration(env, version, commit, task),
  );
  const configurationById = new Map(
    configurations.map((config) => [config.config_id, config]),
  );
  const sessionBindings = new Map<string, string>();
  function install(server: { middlewares: { use: (handler: any) => void } }) {
    server.middlewares.use(
      async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const path = req.url?.split("?")[0];
        if (!["/api/config", "/api/chat", "/api/tasks"].includes(path ?? ""))
          return next();
        // Avoid cross-origin use of this credentialed local API.
        if (
          req.headers.origin &&
          req.headers.origin !==
            (env.PILOT_PUBLIC_ORIGIN ||
              `${(req.socket as any).encrypted ? "https" : "http"}://${req.headers.host}`)
        )
          return json(res, 403, {
            error: "Cross-origin requests are disabled",
          });
        if (path === "/api/tasks")
          return req.method === "GET"
            ? json(res, 200, taskCatalog)
            : json(res, 405, { error: "GET only" });
        if (path === "/api/config") {
          if (req.method !== "GET")
            return json(res, 405, { error: "GET only" });
          const taskId =
            new URL(
              req.url ?? "/api/config",
              "http://localhost",
            ).searchParams.get("task_id") ?? defaultTask.task_id;
          const selected = configurations.find(
            (config) => config.task.task_id === taskId,
          );
          return selected
            ? json(res, 200, selected)
            : json(res, 404, { error: "Unknown task" });
        }
        if (req.method !== "POST")
          return json(res, 405, { error: "POST only" });
        const abort = new AbortController();
        const deadline = setTimeout(
          () => abort.abort(new Error("Upstream timeout (180 seconds)")),
          180_000,
        );
        res.on("close", () => abort.abort());
        let streaming = false;
        let phase = "validation";
        const send = (event: unknown) => {
          if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        try {
          const body = await readBody(req);
          if (
            Object.keys(body).some(
              (k) =>
                !["session_id", "request_id", "config_id", "messages"].includes(
                  k,
                ),
            )
          )
            return json(res, 400, {
              error:
                "Only session/request IDs, config ID and chat messages are accepted",
            });
          if (
            typeof body.session_id !== "string" ||
            typeof body.request_id !== "string"
          )
            return json(res, 400, { error: "Missing session/request ID" });
          const config = configurationById.get(body.config_id);
          if (!config)
            return json(res, 409, {
              error:
                "Session configuration changed. End and export this session; start a new session to use the new configuration.",
            });
          const boundConfig = sessionBindings.get(body.session_id);
          if (boundConfig && boundConfig !== config.config_id)
            return json(res, 409, {
              error:
                "This session is already bound to a different task or model configuration. Start a new session to change tasks.",
            });
          const payload = providerPayload(config, body.messages);
          const credentialError = apiKeyError(env, config.provider);
          if (credentialError)
            return json(res, 503, {
              error: credentialError,
            });
          sessionBindings.set(body.session_id, config.config_id);
          phase = "upstream";
          const response = await upstream(`${config.api_base_url}/responses`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${env.OPENAI_API_KEY?.trim()}`,
              ...(config.project ? { "OpenAI-Project": config.project } : {}),
            },
            body: JSON.stringify(payload),
            signal: abort.signal,
            redirect: "error",
          });
          if (!response.ok) {
            await response.body?.cancel();
            return json(res, response.status, {
              error: `Model API returned HTTP ${response.status}`,
            });
          }
          if (!response.body) throw new Error("Empty upstream stream");
          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
          });
          res.flushHeaders();
          streaming = true;
          let terminal = false;
          for await (const event of readSse(response.body)) {
            if (event.type === "response.created")
              send({
                type: "created",
                response_id: event.response?.id,
                model: event.response?.model,
              });
            if (
              event.type === "response.output_text.delta" ||
              event.type === "response.refusal.delta"
            )
              send({ type: "delta", text: event.delta ?? "" });
            if (event.type === "response.completed") {
              send({
                type: "completed",
                response_id: event.response?.id,
                usage: event.response?.usage,
              });
              terminal = true;
              break;
            }
            if (
              ["response.failed", "response.incomplete", "error"].includes(
                event.type,
              )
            ) {
              send({
                type: "failed",
                error: event.type,
                details:
                  event.response?.incomplete_details ??
                  event.response?.error?.code ??
                  event.code ??
                  null,
              });
              terminal = true;
              break;
            }
          }
          if (!terminal)
            send({
              type: "failed",
              error: "Stream ended without a completion event",
            });
          res.end();
        } catch (e) {
          const error = abort.signal.aborted
            ? "AI request interrupted or timed out"
            : e instanceof Error
              ? e.message
              : String(e);
          if (streaming) {
            send({ type: "failed", error });
            res.end();
          } else if (!res.destroyed)
            json(res, phase === "validation" ? 400 : 502, { error });
        } finally {
          clearTimeout(deadline);
        }
      },
    );
  }
  return {
    name: "comparethink-pilot",
    configureServer: install,
    configurePreviewServer: install,
  };
}
