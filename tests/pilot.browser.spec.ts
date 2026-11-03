import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";

async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Start microphone test" }).click();
  await expect(
    page.getByText("Test recording in progress", { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  await page
    .getByRole("button", { name: "Stop test recording", exact: true })
    .click();
  await page
    .getByLabel("I played the recording and could hear my voice.")
    .check();
  await page.getByRole("button", { name: "Continue to instructions" }).click();
  await page.getByRole("button", { name: "Start task", exact: true }).click();
  await expect(page.getByText("Recording", { exact: true })).toBeVisible();
}
async function database(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("comparethink-pilot-v1");
      r.onsuccess = () => resolve(r.result);
      r.onerror = reject;
    });
    const read = (store: string) =>
      new Promise<any[]>((resolve, reject) => {
        const r = db.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = reject;
      });
    const sessions = await read("sessions"),
      events = await read("events"),
      audio = await read("audio");
    db.close();
    return {
      sessions,
      events,
      audio: audio.map(({ blob, ...a }: any) => ({
        ...a,
        blob_size: blob.size,
      })),
    };
  });
}
async function download(page: Page, buttonName = "Download session ZIP") {
  const waiting = page.waitForEvent("download");
  await page
    .getByRole("button", { name: buttonName, exact: true })
    .first()
    .click();
  const d = await waiting;
  const path = await d.path();
  if (!path) throw new Error("Download missing");
  const bytes = await readFile(path);
  return unzipSync(new Uint8Array(bytes));
}
const text = (files: Record<string, Uint8Array>, file: string) =>
  strFromU8(files[file]);
const parsed = (files: Record<string, Uint8Array>, file: string) =>
  JSON.parse(text(files, file));
async function submit(page: Page, answer = "참가자가 직접 확정한 행동 순서") {
  await page
    .getByRole("button", { name: "Write final plan", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Final plan", exact: true })
    .fill(answer);
  await page
    .getByRole("button", {
      name: "Submit final plan and end session",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Session ended" }),
  ).toBeVisible();
}

test("continuous browser audio covers typing, AI wait and response; event seeks and complete export survive reload", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (e) => browserErrors.push(e.message));
  await start(page);
  const input = page.getByRole("textbox", { name: "Message to AI" });
  await input.fill("첫 번째 초안");
  await page.waitForTimeout(1100);
  await input.fill("수정한 최종 프롬프트");
  // Korean IME Enter must not send even when it looks like a normal Enter keydown.
  await input.dispatchEvent("compositionstart");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 229,
    isComposing: true,
  });
  expect(
    (await database(page)).events.filter((e) => e.type === "prompt_sent"),
  ).toHaveLength(0);
  await input.dispatchEvent("compositionend", { data: "트" });
  await input.press("Enter");
  await expect(
    page.getByText("I have checked the task rules and current state.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({
    path: "test-results/active-desktop.png",
    fullPage: true,
  });
  const during = await database(page);
  expect(during.audio.length).toBeGreaterThanOrEqual(3);
  expect(during.events.some((e) => e.type === "ai_first_display")).toBe(true);
  expect(during.sessions[0].status).toBe("active");
  await submit(page);
  await expect(page.getByText("Complete", { exact: true })).toBeVisible();
  const files = await download(page);
  const meta = parsed(files, "session.json"),
    manifest = parsed(files, "audio/manifest.json");
  const events = text(files, "events.jsonl")
    .trim()
    .split("\n")
    .map((l: string) => JSON.parse(l));
  expect(meta.collection_status).toBe("complete");
  expect(meta.config.model).toBe("fixture-model");
  expect(meta.config.task.language).toBe("en");
  expect(meta.config.task.version).toBe("1.1.0");
  expect(meta.instructions.think_aloud).toContain("waiting for the AI");
  expect(text(files, "final_answer.txt")).toBe(
    "참가자가 직접 확정한 행동 순서",
  );
  expect(
    events
      .filter((e: any) => e.type === "draft_changed")
      .map((e: any) => e.payload.text),
  ).toContain("첫 번째 초안");
  expect(
    events
      .filter((e: any) => e.type === "draft_changed")
      .map((e: any) => e.payload.text),
  ).toContain("수정한 최종 프롬프트");
  expect(new Set(events.map((e: any) => e.event_id)).size).toBe(events.length);
  expect(
    events.every(
      (e: any, i: number) =>
        e.sequence === i + 1 && (!i || e.t_ms >= events[i - 1].t_ms),
    ),
  ).toBe(true);
  const segment = manifest.segments[0];
  expect(manifest.segments).toHaveLength(1);
  expect(segment.stop_reason).toBe("session_end");
  expect(segment.mime_type).toContain("audio/webm");
  const sendEvent = events.find((e: any) => e.type === "prompt_sent");
  const firstEvent = events.find((e: any) => e.type === "ai_first_display");
  expect(firstEvent.t_ms).toBeGreaterThan(sendEvent.t_ms);
  // Decode actual captured Opus in the browser and verify signal across draft and response times.
  const audioBase64 = Buffer.from(files[segment.file]).toString("base64");
  const signal = await page.evaluate(
    async ({ audioBase64, times }) => {
      const context = new AudioContext();
      const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
      const buffer = await context.decodeAudioData(bytes.buffer);
      const data = buffer.getChannelData(0);
      const rms = times.map((t) => {
        const start = Math.floor(t * buffer.sampleRate),
          end = Math.min(
            start + Math.floor(buffer.sampleRate * 0.15),
            data.length,
          );
        let sum = 0;
        for (let i = start; i < end; i++) sum += data[i] ** 2;
        return Math.sqrt(sum / Math.max(1, end - start));
      });
      await context.close();
      return { duration: buffer.duration, rms };
    },
    {
      audioBase64,
      times: [
        0.7,
        (sendEvent.t_ms - segment.started_t_ms) / 1000 + 0.3,
        (firstEvent.t_ms - segment.started_t_ms) / 1000 + 0.3,
      ],
    },
  );
  expect(signal.duration).toBeGreaterThan(
    (firstEvent.t_ms - segment.started_t_ms) / 1000 + 0.3,
  );
  expect(signal.rms.every((n) => n > 0.001)).toBe(true);
  await page.getByRole("button", { name: /AI first response/ }).click();
  await expect
    .poll(() =>
      page
        .locator(".review audio")
        .evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeGreaterThan((firstEvent.t_ms - segment.started_t_ms) / 1000 - 0.1);
  const payloads = await (await page.request.get("/__test/requests")).json();
  const payload = payloads.find((p: any) =>
    p.input.some((m: any) => m.content === "수정한 최종 프롬프트"),
  );
  expect(Object.keys(payload).sort()).toEqual([
    "input",
    "instructions",
    "max_output_tokens",
    "model",
    "store",
    "stream",
  ]);
  expect(payload.input).toEqual([
    { role: "user", content: "수정한 최종 프롬프트" },
  ]);
  expect(JSON.stringify(payload)).not.toMatch(
    /ground_truth_plan|첫 번째 초안|audioBase64|think_aloud/,
  );
  await page.screenshot({
    path: "test-results/completed-desktop.png",
    fullPage: true,
  });
  await page.reload();
  const reexport = await download(page, "Download ZIP again");
  expect(parsed(reexport, "session.json").session_id).toBe(meta.session_id);
  expect(reexport[segment.file]).toEqual(files[segment.file]);
  expect(browserErrors).toEqual([]);
});

test("HTTP failure, partial stream failure and microphone interruption retain data and mark incomplete", async ({
  page,
}) => {
  await start(page);
  const input = page.getByRole("textbox", { name: "Message to AI" });
  await input.fill("FAIL_HTTP");
  await input.press("Enter");
  await expect(
    page.getByText("Failed · received text retained", { exact: true }),
  ).toHaveCount(1);
  await input.fill("FAIL_STREAM");
  await input.press("Enter");
  await expect(
    page.getByText("Partial response retained.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Failed · received text retained", { exact: true }),
  ).toHaveCount(2);
  // Simulate a physical microphone ending through the real track's ended event.
  await page.evaluate(() => {
    for (const track of (window as any).__testMicStream.getAudioTracks()) {
      track.stop();
      track.dispatchEvent(new Event("ended"));
    }
  });
  await expect(
    page.getByText("Recording stopped", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reconnect microphone" }).click();
  await expect(page.getByText("Recording", { exact: true })).toBeVisible();
  await page.waitForTimeout(1100);
  await submit(page, "오류 이후 직접 제출한 최종 계획");
  const files = await download(page),
    events = text(files, "events.jsonl");
  expect(parsed(files, "session.json").collection_status).toBe("incomplete");
  expect(events).toContain("recording_error");
  expect(events).toContain("collection_gap_started");
  expect(events).toContain("ai_failed");
  expect(parsed(files, "audio/manifest.json").segments).toHaveLength(2);
  expect(
    parsed(files, "messages.json").find(
      (m: any) => m.content === "Partial response retained.",
    ).status,
  ).toBe("failed");
  expect(text(files, "final_answer.txt")).toBe(
    "오류 이후 직접 제출한 최종 계획",
  );
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ native }) => {
      const original = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (native) {
          const stream = await original(constraints);
          (window as any).__testMicStream = stream;
          return stream;
        }
        // Actual browser MediaStream/MediaRecorder; only the device boundary is replaced.
        const context = new AudioContext();
        await context.resume();
        const oscillator = context.createOscillator(),
          gain = context.createGain();
        oscillator.frequency.value = 440;
        gain.gain.value = 0.25;
        const destination = context.createMediaStreamDestination();
        oscillator.connect(gain);
        gain.connect(destination);
        oscillator.start();
        for (const track of destination.stream.getTracks()) {
          const stop = track.stop.bind(track);
          let stopped = false;
          track.stop = () => {
            if (stopped) return;
            stopped = true;
            stop();
            oscillator.stop();
            void context.close().catch(() => {});
          };
        }
        (window as any).__testMicStream = destination.stream;
        return destination.stream;
      };
    },
    { native: process.env.PILOT_TEST_AUDIO === "native" },
  );
});

test("participant can interrupt streaming without losing received text or auto-submitting it", async ({
  page,
}) => {
  await start(page);
  const input = page.getByRole("textbox", { name: "Message to AI" });
  await input.fill("SLOW_STREAM");
  await input.press("Enter");
  await expect(page.getByText("I have checked", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Stop response", exact: true })
    .click();
  await expect(
    page.getByText("Interrupted · received text retained"),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "End session without submitting",
      exact: true,
    })
    .click();
  const files = await download(page);
  expect(text(files, "final_answer.txt")).toBe("");
  expect(parsed(files, "session.json").collection_status).toBe("incomplete");
  expect(parsed(files, "messages.json")[1]).toMatchObject({
    content: "I have checked ",
    status: "interrupted",
  });
});

test("storage failure retains memory and earlier disk records; retry appends without replacing prior events", async ({
  page,
}) => {
  await start(page);
  await page.waitForTimeout(1200);
  const before = await database(page);
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    (window as any).__restoreTransaction = () => {
      IDBDatabase.prototype.transaction = original;
    };
    IDBDatabase.prototype.transaction = function (...args: any[]) {
      if (args[1] === "readwrite")
        throw new DOMException("Injected quota failure", "QuotaExceededError");
      return original.apply(this, args as any);
    };
  });
  await page
    .getByRole("textbox", { name: "Message to AI" })
    .fill("저장 실패 중에도 보존할 초안");
  await expect(
    page.getByRole("button", { name: "Retry saving" }),
  ).toBeVisible();
  const emergency = await download(page, "Download current record");
  expect(
    parsed(emergency, "session.json").export.pending_writes,
  ).toBeGreaterThan(0);
  expect(text(emergency, "events.jsonl")).toContain(
    "저장 실패 중에도 보존할 초안",
  );
  await page.evaluate(() => (window as any).__restoreTransaction());
  await page.getByRole("button", { name: "Retry saving" }).click();
  await expect(page.getByRole("button", { name: "Retry saving" })).toHaveCount(
    0,
  );
  await submit(page);
  const files = await download(page),
    events = text(files, "events.jsonl")
      .trim()
      .split("\n")
      .map((line: string) => JSON.parse(line));
  expect(parsed(files, "session.json").collection_status).toBe("incomplete");
  expect(
    events.map((e: any) => e.event_id).slice(0, before.events.length),
  ).toEqual(before.events.map((e: any) => e.event_id));
  expect(events.some((e: any) => e.type === "storage_error")).toBe(true);
  expect(events.some((e: any) => e.type === "storage_recovered")).toBe(true);
  expect(text(files, "events.jsonl")).toContain("저장 실패 중에도 보존할 초안");
});

test("closed tab recovery exports persisted unfinished capture as incomplete without inventing an answer", async ({
  page,
}) => {
  await start(page);
  await page
    .getByRole("textbox", { name: "Message to AI" })
    .fill("미종료 세션의 초안");
  await page.waitForTimeout(1300);
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Saved sessions", exact: true }),
  ).toBeVisible();
  const files = await download(page, "Download ZIP again");
  expect(parsed(files, "session.json").collection_status).toBe("incomplete");
  expect(text(files, "events.jsonl")).toContain("미종료 세션의 초안");
  expect(text(files, "final_answer.txt")).toBe("");
  expect(Object.keys(files).some((k) => /^audio\/segment/.test(k))).toBe(true);
});

test("server rejects model changes and research audio fields; mobile layout has no horizontal overflow", async ({
  page,
}) => {
  const config = await (await page.request.get("/api/config")).json();
  const body = {
    session_id: "s",
    request_id: "r",
    config_id: config.config_id,
    messages: [{ role: "user", content: "hi" }],
  };
  expect(
    (
      await page.request.post("/api/chat", {
        data: { ...body, config_id: "changed" },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.post("/api/chat", {
        data: { ...body, think_aloud: "private audio" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.post("/api/chat", {
        data: {
          ...body,
          messages: [{ role: "user", content: "hi", audio: "private" }],
        },
      })
    ).status(),
  ).toBeGreaterThanOrEqual(400);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Microphone check" }),
  ).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/[가-힣]/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/onboarding-mobile.png",
    fullPage: true,
  });
});

test("microphone permission failure is visible and does not advance to the task", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Permission denied (fixture)", "NotAllowedError");
    };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start microphone test", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Permission denied");
  await expect(
    page.getByRole("button", { name: "Continue to instructions" }),
  ).toBeDisabled();
});
