import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTsBundle } from "../scripts/loadTsBundle.mjs";
const { accessGuard, ACCESS_HEADER } = await loadTsBundle(
  "server/access.ts",
  "node",
);
const { pilotPlugin } = await loadTsBundle("server/pilotPlugin.ts", "node");
const { sttPlugin } = await loadTsBundle("server/sttPlugin.ts", "node");
const access = await loadTsBundle("src/pilot/access.ts", "node");

const token = "participant-key-0123456789";
const other = "researcher-key-abcdefghijkl";

function handlerOf(plugin) {
  let handler;
  plugin.configureServer({
    middlewares: {
      use(fn) {
        handler = fn;
      },
    },
  });
  return async (url, key) => {
    const req = {
      method: "GET",
      url,
      headers: { host: "localhost", ...(key ? { [ACCESS_HEADER]: key } : {}) },
      socket: {},
    };
    const res = { status: 0, body: "" };
    res.writeHead = (status) => (res.status = status);
    res.end = (body) => (res.body = body ?? "");
    let next = false;
    await handler(req, res, () => (next = true));
    return {
      status: res.status,
      body: res.body ? JSON.parse(res.body) : {},
      next,
    };
  };
}

test("access guard is open without tokens and rejects missing or wrong keys when configured", () => {
  const request = (key) => ({ headers: key ? { [ACCESS_HEADER]: key } : {} });
  assert.equal(accessGuard({})(request()), true);
  const guard = accessGuard({ PILOT_ACCESS_TOKENS: `${token}, ${other}` });
  assert.equal(guard(request()), false);
  assert.equal(guard(request("participant-key-wrong-value")), false);
  assert.equal(guard(request(token)), true);
  assert.equal(guard(request(other)), true);
  assert.throws(
    () => accessGuard({ PILOT_ACCESS_TOKENS: "short" }),
    /PILOT_ACCESS_TOKENS/,
  );
  assert.throws(
    () => accessGuard({ PILOT_ACCESS_TOKENS: "has spaces?and=symbols-long" }),
    /PILOT_ACCESS_TOKENS/,
  );
});

test("chat, task and transcription APIs require the access key when tokens are configured", async () => {
  const env = {
    OPENAI_API_KEY: "test-secret",
    OPENAI_MODEL: "pinned-test-model",
    PILOT_ACCESS_TOKENS: token,
  };
  const pilot = handlerOf(pilotPlugin(env, "test", "test"));
  const stt = handlerOf(sttPlugin(env, process.cwd()));
  for (const call of [pilot, stt]) {
    const path = call === pilot ? "/api/tasks" : "/api/stt/config";
    const denied = await call(path);
    assert.equal(denied.status, 401);
    assert.match(denied.body.error, /Access link/);
    assert.equal((await call(path, "participant-key-wrong-value")).status, 401);
    assert.equal((await call(path, token)).status, 200);
  }
  assert.equal((await pilot("/api/config", token)).status, 200);
  assert.equal((await pilot("/api/config")).status, 401);
  // Non-API paths (the page and its assets) still load without a key.
  assert.equal((await pilot("/")).next, true);
  // Without configured tokens the API stays open for local development.
  const open = handlerOf(
    pilotPlugin({ OPENAI_API_KEY: "k", OPENAI_MODEL: "m" }, "test", "test"),
  );
  assert.equal((await open("/api/tasks")).status, 200);
});

test("client keeps the link key for this tab, removes it from the address bar and sends it to the API", async () => {
  const fakeWindow = (href, storage = new Map(), failStorage = false) => {
    const win = {
      location: { href },
      history: {
        state: null,
        replaceState(_, __, url) {
          win.location.href = String(url);
        },
      },
      sessionStorage: {
        setItem(k, v) {
          if (failStorage) throw new Error("blocked");
          storage.set(k, v);
        },
        getItem(k) {
          if (failStorage) throw new Error("blocked");
          return storage.get(k) ?? null;
        },
      },
    };
    return win;
  };
  const storage = new Map();
  const win = fakeWindow(
    `https://pilot.example/?lang=ko&key=${token}&task=travelplanner`,
    storage,
  );
  assert.equal(access.captureAccessKey(win), token);
  assert.equal(
    win.location.href,
    "https://pilot.example/?lang=ko&task=travelplanner",
  );
  // A reload in the same tab restores the key from tab storage.
  assert.equal(
    access.captureAccessKey(
      fakeWindow("https://pilot.example/?lang=ko", storage),
    ),
    token,
  );

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response("{}");
  };
  try {
    await access.apiFetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const headers = new Headers(calls[0].init.headers);
    assert.equal(headers.get(access.ACCESS_HEADER), token);
    assert.equal(headers.get("Content-Type"), "application/json");
  } finally {
    globalThis.fetch = originalFetch;
  }

  // Without tab storage the key stays in the URL so a reload keeps working.
  const blocked = fakeWindow(
    `https://pilot.example/?key=${token}`,
    new Map(),
    true,
  );
  assert.equal(access.captureAccessKey(blocked), token);
  assert.match(blocked.location.href, /key=/);
  // A link without a key and no stored key sends no header.
  assert.equal(
    access.captureAccessKey(fakeWindow("https://pilot.example/")),
    undefined,
  );
});
