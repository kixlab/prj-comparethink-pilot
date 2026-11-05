import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";

async function start(page: Page, task?: "travelplanner" | "blocksworld") {
  await page.goto("/");
  if (task)
    await page
      .getByRole("combobox", { name: "Task", exact: true })
      .selectOption({
        label:
          task === "travelplanner"
            ? "TravelPlanner itinerary task"
            : "Blocksworld planning task",
      });
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
  expect(meta.config.task.version).toBe("1.2.0");
  expect(meta.instructions.think_aloud).toContain("waiting for the AI");
  expect(text(files, "final_answer.txt")).toBe(
    "참가자가 직접 확정한 행동 순서",
  );
  expect(events.some((e: any) => /draft|composition/.test(e.type))).toBe(false);
  expect(text(files, "events.jsonl")).not.toContain("첫 번째 초안");
  expect(text(files, "events.jsonl")).toContain("수정한 최종 프롬프트");
  expect(meta.collection_policy.draft_capture).toBe(false);
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
  const timeline = parsed(files, "audio/timeline.json");
  const phases = [
    "prompt_sent",
    "ai_request_started",
    "ai_request_dispatched",
    "ai_response_headers_received",
    "ai_first_text_received",
    "ai_first_display",
    "ai_paint_observed",
    "ai_completed",
  ];
  const markers = phases.map((type) =>
    timeline.markers.find((m: any) => m.type === type),
  );
  expect(markers.map((m: any) => m.sequence)).toEqual(
    markers.map((m: any) => m.sequence).sort((a: number, b: number) => a - b),
  );
  for (const marker of markers) {
    expect(marker.mapping_status).toBe("mapped");
    expect(marker.audio_file).toBe(segment.file);
    expect(marker.audio_position_seconds).toBeCloseTo(
      (marker.t_ms - segment.started_t_ms) / 1000,
      6,
    );
    expect(marker.turn_index).toBe(1);
    expect(marker.request_id).toBe(sendEvent.payload.request_id);
  }
  expect(parsed(files, "messages.json")[1].first_received_t_ms).toBe(
    markers[4].t_ms,
  );
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
  await expect(
    page.getByRole("heading", { name: "Conversation", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Microphone timeline", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".review-message.human")).toContainText(
    "수정한 최종 프롬프트",
  );
  await expect(page.locator(".review-message.assistant")).toContainText(
    "I have checked the task rules and current state.",
  );
  await expect(page.locator(".recording-waveform path")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Play AI response 1", exact: true })
    .click();
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

test("completed review connects multiple exchanges, waveform playback and timeline markers on desktop and mobile", async ({
  page,
}) => {
  await start(page);
  const input = page.getByRole("textbox", { name: "Message to AI" });
  for (const prompt of [
    "First planning question",
    "Follow-up planning question",
  ]) {
    await input.fill(prompt);
    await input.press("Enter");
    await expect(
      page.getByRole("button", { name: "Send", exact: true }),
    ).toBeVisible();
  }
  await submit(page, "My final plan for review");
  const review = page.getByRole("region", {
    name: "Session review",
    exact: true,
  });
  await expect(review.locator(".review-exchange")).toHaveCount(2);
  await expect(review.locator(".review-message.human")).toHaveCount(2);
  await expect(review.locator(".review-message.assistant")).toHaveCount(2);
  await expect(review.locator(".recording-waveform path")).toHaveCount(1);
  await review
    .getByRole("button", { name: "Jump to AI response 2", exact: true })
    .click();
  await expect(
    review.getByRole("region", { name: "Exchange 2 timing", exact: true }),
  ).toBeVisible();
  await expect(review.locator(".review-exchange.selected")).toContainText(
    "Follow-up planning question",
  );
  await expect(
    review.locator(".review-message.assistant.at-playhead"),
  ).toHaveCount(1);
  await review.locator("audio").evaluate((a: HTMLAudioElement) => a.pause());
  await page.screenshot({
    path: "test-results/review-desktop.png",
    fullPage: true,
  });
  await review
    .getByRole("button", { name: "Jump to human message 1", exact: true })
    .click();
  await expect(review.locator(".review-exchange.selected")).toContainText(
    "First planning question",
  );
  await review.locator("audio").evaluate((a: HTMLAudioElement) => a.pause());
  // Native audio seeking updates the common clock and selects the corresponding exchange.
  const stored = await database(page);
  const secondPrompt = stored.events.filter(
    (e: any) => e.type === "prompt_sent",
  )[1];
  const recorded = stored.sessions[0].audio_segments[0];
  await review.locator("audio").evaluate(
    (a: HTMLAudioElement, t) => {
      a.currentTime = t;
    },
    (secondPrompt.t_ms - recorded.started_t_ms) / 1000 + 0.15,
  );
  await expect(review.locator(".review-exchange.selected")).toContainText(
    "Follow-up planning question",
  );
  await review
    .getByRole("slider", { name: "Seek session recording" })
    .fill("0");
  await expect(review.locator(".review-exchange.selected")).toHaveCount(0);
  await review
    .getByRole("button", { name: "Play final submission", exact: true })
    .click();
  await expect(review.locator(".review-final.selected")).toHaveCount(1);
  await review.locator("audio").evaluate((a: HTMLAudioElement) => a.pause());
  await review
    .getByRole("combobox", { name: "Timeline zoom" })
    .selectOption("4");
  await expect
    .poll(() =>
      review.locator(".review-timeline-scroll").evaluate((el) => el.scrollLeft),
    )
    .toBeGreaterThan(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    review.getByRole("heading", { name: "Microphone timeline", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      review
        .locator(".timeline-playhead")
        .first()
        .evaluate((el) => {
          const bounds = el.getBoundingClientRect(),
            viewport = el
              .closest(".review-timeline-scroll")!
              .getBoundingClientRect();
          return bounds.left >= viewport.left && bounds.right <= viewport.right;
        }),
    )
    .toBe(true);
  await expect
    .poll(() =>
      review.locator(".review-final .review-message-text").evaluate((el) => {
        const bounds = el.getBoundingClientRect(),
          pane = el.closest(".review-transcript")!.getBoundingClientRect();
        return bounds.top >= pane.top && bounds.bottom <= pane.bottom;
      }),
    )
    .toBe(true);
  await expect
    .poll(() =>
      review
        .getByRole("button", { name: "Jump to final answer", exact: true })
        .evaluate((el) => {
          const point = el.getBoundingClientRect(),
            frame = el
              .closest(".review-timeline-scroll")!
              .getBoundingClientRect();
          return point.left >= frame.left && point.right <= frame.right;
        }),
    )
    .toBe(true);
  await review
    .locator(".review-timeline-scroll")
    .screenshot({ path: "test-results/review-timeline-mobile.png" });
  await page.screenshot({
    path: "test-results/review-mobile.png",
    fullPage: true,
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Review recording", exact: true })
    .click();
  await expect(page.locator(".review-message.human")).toHaveCount(2);
  await expect(page.locator(".review-final")).toContainText(
    "My final plan for review",
  );
});

test("post-task transcripts seek the source recording, survive retries, cancellation, storage failure and reload without entering chat", async ({
  page,
}) => {
  await page.request.post("/__test/stt-mode", { data: { mode: "success" } });
  await start(page);
  const input = page.getByRole("textbox", { name: "Message to AI" });
  await input.fill("Help with this planning task");
  await input.press("Enter");
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  await submit(page);
  const panel = page.getByRole("region", {
    name: "Think-aloud transcript",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "Generate transcript", exact: true })
    .click();
  await expect(panel.locator(".transcript-cue")).toHaveCount(2);
  await panel.locator(".transcript-cue button").nth(1).click();
  await expect
    .poll(() =>
      page
        .locator(".review audio")
        .evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeGreaterThanOrEqual(1.19);
  await page
    .locator(".review audio")
    .evaluate((a: HTMLAudioElement) => a.pause());
  await page.screenshot({
    path: "test-results/transcript-review-desktop.png",
    fullPage: true,
  });
  const first = await download(page);
  const firstMeta = parsed(first, "transcriptions.json");
  const completed = firstMeta.entries.find(
    (entry: any) => entry.status === "completed",
  );
  expect(completed.result.cues[0].start_t_ms).toBeCloseTo(
    completed.source.started_t_ms + 300,
    3,
  );
  expect(text(first, "transcript.vtt")).toContain("WEBVTT");
  expect(text(first, "transcript.txt")).toContain(
    "먼저 조건을 확인하고 있어요",
  );
  expect(text(first, "messages.json")).not.toContain(
    "먼저 조건을 확인하고 있어요",
  );
  const audioFile = parsed(first, "audio/manifest.json").segments[0].file;
  await page.request.post("/__test/stt-mode", { data: { mode: "fail" } });
  await panel
    .getByRole("button", { name: "Transcribe again", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText("Injected STT failure");
  await expect(panel.locator(".transcript-cue")).toHaveCount(2);
  const failed = await download(page);
  expect(
    parsed(failed, "transcriptions.json").entries.some(
      (e: any) => e.status === "failed",
    ),
  ).toBe(true);
  expect(
    parsed(failed, "transcriptions.json").entries.find(
      (e: any) => e.entry_id === completed.entry_id,
    ),
  ).toEqual(completed);
  expect(failed[audioFile]).toEqual(first[audioFile]);
  await page.request.post("/__test/stt-mode", { data: { mode: "slow" } });
  await panel
    .getByRole("button", { name: "Transcribe again", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Cancel transcription", exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Cancel transcription", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Transcribe again", exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole("alert")).toContainText("cancelled");
  await expect(panel.locator(".transcript-cue")).toHaveCount(2);
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    (window as any).__restoreTranscriptTransaction = () => {
      IDBDatabase.prototype.transaction = original;
    };
    IDBDatabase.prototype.transaction = function (...args: any[]) {
      if (args[0] === "transcriptions" && args[1] === "readwrite")
        throw new DOMException(
          "Injected transcript quota",
          "QuotaExceededError",
        );
      return original.apply(this, args as any);
    };
  });
  await panel
    .getByRole("button", { name: "Transcribe again", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Retry saving transcript", exact: true }),
  ).toBeVisible();
  const pending = await download(page);
  expect(
    parsed(pending, "transcriptions.json").unsaved_entry_ids.length,
  ).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).__restoreTranscriptTransaction());
  await panel
    .getByRole("button", { name: "Retry saving transcript", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Retry saving transcript", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("button", { name: "Review recording", exact: true })
    .click();
  await expect(page.locator(".transcript-cue")).toHaveCount(2);
  const again = await download(page, "Download ZIP again");
  const entries = parsed(again, "transcriptions.json").entries;
  expect(entries.some((e: any) => e.status === "interrupted")).toBe(true);
  expect(entries.find((e: any) => e.entry_id === completed.entry_id)).toEqual(
    completed,
  );
  expect(parsed(again, "transcriptions.json").unsaved_entry_ids).toEqual([]);
  expect(again[audioFile]).toEqual(first[audioFile]);
  const chatRequests = await (
    await page.request.get("/__test/requests")
  ).json();
  expect(JSON.stringify(chatRequests)).not.toMatch(
    /먼저 조건을 확인|다음 계획을 생각/,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/transcript-review-mobile.png",
    fullPage: true,
  });
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
  const timeline = parsed(files, "audio/timeline.json");
  const finalMarker = timeline.markers.find(
    (m: any) => m.type === "final_submitted",
  );
  expect(finalMarker.audio_file).toBe("audio/segment-002.webm");
  expect(finalMarker.mapping_status).toBe("mapped");
  await page
    .getByRole("button", { name: "Play final submission", exact: true })
    .click();
  const segmentSelector = page.getByRole("combobox", {
    name: "Recording segment",
  });
  await expect(segmentSelector).toHaveValue(finalMarker.segment_id);
  await expect(page.locator(".review [role=status]")).toContainText(
    "Final submission: session",
  );
  const firstMarker = timeline.markers.find(
    (m: any) => m.type === "prompt_sent",
  );
  await page
    .getByRole("button", { name: "Play Human message 1", exact: true })
    .click();
  await expect(segmentSelector).toHaveValue(firstMarker.segment_id);
  await expect(page.locator(".review [role=status]")).toContainText(
    "Prompt sent: session",
  );
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
    .getByRole("button", { name: "Write final plan", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Final plan", exact: true })
    .fill("UNSUBMITTED_FINAL_PRIVATE");
  await page
    .getByRole("button", {
      name: "End session without submitting",
      exact: true,
    })
    .click();
  const files = await download(page);
  expect(text(files, "final_answer.txt")).toBe("");
  expect(text(files, "events.jsonl")).not.toContain(
    "UNSUBMITTED_FINAL_PRIVATE",
  );
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
  expect(text(emergency, "events.jsonl")).toContain("storage_error");
  expect(text(emergency, "events.jsonl")).not.toContain(
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
  expect(text(files, "events.jsonl")).not.toContain(
    "저장 실패 중에도 보존할 초안",
  );
});

test("closed tab recovery exports persisted unfinished capture as incomplete without inventing an answer", async ({
  page,
}) => {
  await start(page);
  await page
    .getByRole("textbox", { name: "Message to AI" })
    .fill("미종료 세션의 초안");
  const input = page.getByRole("textbox", { name: "Message to AI" });
  await input.fill("미종료 세션의 전송 프롬프트");
  await input.press("Enter");
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  await input.fill("보내지 않은 내용");
  await page.waitForTimeout(1300);
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Saved sessions", exact: true }),
  ).toBeVisible();
  const files = await download(page, "Download ZIP again");
  expect(parsed(files, "session.json").collection_status).toBe("incomplete");
  expect(text(files, "events.jsonl")).toContain("미종료 세션의 전송 프롬프트");
  expect(text(files, "events.jsonl")).not.toMatch(
    /미종료 세션의 초안|보내지 않은 내용/,
  );
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

test("TravelPlanner selection supplies the same complete travel data to the participant and AI and survives export", async ({
  page,
}) => {
  await start(page, "travelplanner");
  await expect(
    page.getByRole("heading", {
      name: "TravelPlanner itinerary task",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Initial state", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Task", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/within a budget of \$1,400/)).toBeVisible();
  const flightTitle = "Flight from Washington to Myrtle Beach on 2022-03-13";
  await page.locator("summary").filter({ hasText: flightTitle }).click();
  const flight = page.getByRole("table", { name: flightTitle, exact: true });
  await expect(flight.getByText("F3792603", { exact: true })).toBeVisible();
  await page
    .locator("summary")
    .filter({ hasText: "Restaurants in Myrtle Beach" })
    .click();
  await expect(
    page
      .getByRole("table", { name: "Restaurants in Myrtle Beach", exact: true })
      .getByRole("row"),
  ).toHaveCount(29);
  await page
    .getByRole("textbox", { name: "Message to AI" })
    .fill("Help me prepare the TravelPlanner itinerary.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText(
      "I can help prepare a day-by-day itinerary using the supplied travel data.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/travelplanner-desktop.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await submit(
    page,
    "My test itinerary: Day 1, Day 2, Day 3. This is a collection test.",
  );
  const files = await download(page);
  const meta = parsed(files, "session.json"),
    task = parsed(files, "task.json");
  expect(meta.collection_status).toBe("complete");
  expect(meta.config.task.kind).toBe("travelplanner");
  expect(task.task_id).toBe("travelplanner-validation-row-0");
  expect(task.source.row_index).toBe(0);
  expect(meta.instructions.task).toContain("day-by-day itinerary");
  expect(meta.instructions.task).not.toContain("action sequence");
  expect(Object.keys(task.reference_information)).toHaveLength(9);
  expect(text(files, "final_answer.txt")).toContain("My test itinerary");
  const events = text(files, "events.jsonl")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(events.find((e) => e.type === "task_started").payload.task_id).toBe(
    task.task_id,
  );
  const requests = await (await page.request.get("/__test/requests")).json();
  const request = requests.find((r: any) =>
    r.input.some(
      (m: any) => m.content === "Help me prepare the TravelPlanner itinerary.",
    ),
  );
  const context = JSON.parse(request.instructions.split("\n\n").at(-1));
  expect(context.query).toBe(task.query);
  expect(context.reference_information).toEqual(task.reference_information);
  expect(request.instructions).not.toMatch(
    /red block|ground_truth_plan|annotated_plan/,
  );
  await page.reload();
  await expect(
    page
      .locator(".saved-row")
      .getByText("TravelPlanner itinerary task", { exact: true }),
  ).toBeVisible();
  const again = await download(page, "Download ZIP again");
  expect(parsed(again, "task.json")).toEqual(task);
});

test("task links and switching work before capture, and the server rejects a task change within a chat session", async ({
  page,
}) => {
  const catalog = await (await page.request.get("/api/tasks")).json();
  expect(catalog.tasks.map((t: any) => t.kind)).toEqual([
    "blocksworld",
    "travelplanner",
  ]);
  expect(JSON.stringify(catalog)).not.toContain("reference_information");
  const block = await (await page.request.get("/api/config")).json();
  const travel = await (
    await page.request.get("/api/config?task_id=travelplanner-validation-row-0")
  ).json();
  expect(travel.config_id).not.toBe(block.config_id);
  expect((await page.request.get("/api/config?task_id=unknown")).status()).toBe(
    404,
  );
  const sessionId = `binding-${Date.now()}`;
  const first = await page.request.post("/api/chat", {
    data: {
      session_id: sessionId,
      request_id: "r1",
      config_id: block.config_id,
      messages: [{ role: "user", content: "Check task binding" }],
    },
  });
  expect(first.status()).toBe(200);
  const changed = await page.request.post("/api/chat", {
    data: {
      session_id: sessionId,
      request_id: "r2",
      config_id: travel.config_id,
      messages: [{ role: "user", content: "Switch within session" }],
    },
  });
  expect(changed.status()).toBe(409);
  await page.goto("/?task=travelplanner");
  const selection = page.getByRole("combobox", { name: "Task", exact: true });
  await expect(selection).toHaveValue(travel.task.task_id);
  await selection.selectOption(block.task.task_id);
  await expect(page).toHaveURL(/task=blocksworld/);
  await page.reload();
  await expect(selection).toHaveValue(block.task.task_id);
  await page.goto("/?task=unknown");
  await expect(page.getByRole("alert")).toContainText("Unknown task");
  await selection.selectOption(travel.task.task_id);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/task-selection-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
