import { useEffect, useMemo, useRef, useState } from "react";
import type { Message, Snapshot } from "./types";
import { errorText } from "./types";
import { messagesFromEvents } from "./export";
import { audioTimeline } from "./timing";
import TranscriptionPanel from "./TranscriptionPanel";
import AudioWindowControls from "./AudioWindowControls";
import { reviewWindows, windowPlayback } from "./reviewWindows";
import type { ReviewWindow, WindowAudioPart } from "./reviewWindows";

type Marker = ReturnType<typeof audioTimeline>[number];
const time = (ms: number, decimals = 1) => {
  const scale = 10 ** decimals;
  const value = Math.floor((Math.max(0, ms) * scale) / 1000) / scale;
  const minutes = Math.floor(value / 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${(value % 60).toFixed(decimals).padStart(decimals ? decimals + 3 : 2, "0")}`;
};
const terminalLabels: Record<Message["status"], string> = {
  sent: "Sent",
  streaming: "Unfinished",
  completed: "Completed",
  interrupted: "Interrupted",
  failed: "Failed",
};

export default function SessionReview({ snapshot }: { snapshot: Snapshot }) {
  const { session, audio } = snapshot;
  const messages = useMemo(
    () => messagesFromEvents(snapshot.events),
    [snapshot],
  );
  const markers = useMemo(() => audioTimeline(snapshot), [snapshot]);
  const windowData = useMemo(() => reviewWindows(snapshot), [snapshot]);
  const [includeContext, setIncludeContext] = useState(true);
  const [windowSelection, setWindowSelection] = useState<{
    window_id: string;
    request_id: string | null;
    part_index: number;
  } | null>(null);
  const [windowStatus, setWindowStatus] = useState("Stopped");
  const windowRun = useRef<{ part: WindowAudioPart } | null>(null);
  const windowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedWindow = windowData.windows.find(
    (w) => w.window_id === windowSelection?.window_id,
  );
  const selectedPlayback = useMemo(
    () =>
      selectedWindow
        ? windowPlayback(
            snapshot,
            selectedWindow,
            includeContext ? 2000 : 0,
            windowData,
          )
        : null,
    [snapshot, selectedWindow?.window_id, includeContext, windowData],
  );
  const exchanges = useMemo(
    () =>
      messages
        .filter((m) => m.role === "user")
        .map((human, i) => ({
          number: i + 1,
          human,
          ai: messages.find(
            (m) => m.role === "assistant" && m.request_id === human.request_id,
          ),
          markers: markers.filter((m) => m.request_id === human.request_id),
        })),
    [messages, markers],
  );
  const end = Math.max(
    1,
    session.ended_t_ms ?? session.last_t_ms,
    ...session.audio_segments.map((s) => s.ended_t_ms ?? s.started_t_ms),
  );
  const [segmentId, setSegmentId] = useState(
    session.audio_segments[0]?.segment_id ?? "",
  );
  const [source, setSource] = useState<{
    segmentId: string;
    url: string;
  } | null>(null);
  const [playhead, setPlayhead] = useState(session.task_started_t_ms ?? 0);
  const [selectedRequest, setSelectedRequest] = useState(
    exchanges[0]?.human.request_id ?? "",
  );
  const [notice, setNotice] = useState("");
  const [selectedFinal, setSelectedFinal] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [waveforms, setWaveforms] = useState<Record<string, number[] | null>>(
    {},
  );
  const audioEl = useRef<HTMLAudioElement>(null);
  const transcriptEl = useRef<HTMLDivElement>(null);
  const timelineEl = useRef<HTMLDivElement>(null);
  const timelineTrack = useRef<HTMLDivElement>(null);
  const pendingSeek = useRef<{
    segmentId: string;
    position: number;
    autoplay: boolean;
  } | null>(null);
  const segment = session.audio_segments.find(
    (s) => s.segment_id === segmentId,
  );
  const selectedRequestForView = windowSelection?.request_id ?? selectedRequest;
  const selected = exchanges.find(
    (e) => e.human.request_id === selectedRequestForView,
  );
  const activeMessage = messages
    .filter(
      (m) =>
        (m.role === "user"
          ? m.created_t_ms
          : (m.first_display_t_ms ?? Infinity)) <=
        playhead + 1,
    )
    .at(-1);
  const finalMarker = markers.find((m) => m.type === "final_submitted");
  // A selected submission stays visible even if the playable audio ends before its observed timestamp.
  const atFinal =
    selectedFinal ||
    (finalMarker !== undefined && playhead >= finalMarker.t_ms - 1);
  const activeEntryId = atFinal
    ? "final-submission"
    : activeMessage?.message_id;
  const audioGaps = session.gaps.filter(
    (g) => g.kind.startsWith("audio") || g.kind.startsWith("collector"),
  );
  const hasPlaybackPosition =
    segment &&
    playhead >= segment.started_t_ms &&
    playhead <= (segment.ended_t_ms ?? end) &&
    !audioGaps.some(
      (g) =>
        g.kind.startsWith("audio") &&
        playhead >= g.start_t_ms &&
        playhead < (g.end_t_ms ?? end),
    );
  const position = (ms: number) =>
    `${Math.max(0, Math.min(100, (ms / end) * 100))}%`;
  const spanStyle = (start: number, stop: number) => ({
    left: position(start),
    width: `${Math.max(0, ((Math.min(end, stop) - start) / end) * 100)}%`,
  });

  useEffect(() => {
    if (!segment) {
      setSource(null);
      return;
    }
    const chunks = audio
      .filter((c) => c.segment_id === segmentId)
      .sort((a, b) => a.index - b.index);
    if (!chunks.some((c) => c.size)) {
      setSource(null);
      return;
    }
    const url = URL.createObjectURL(
      new Blob(
        chunks.map((c) => c.blob),
        { type: segment.mime_type },
      ),
    );
    setSource({ segmentId, url });
    return () => URL.revokeObjectURL(url);
  }, [segmentId, audio, session.audio_segments]);

  useEffect(() => {
    let cancelled = false;
    let context: AudioContext;
    try {
      context = new AudioContext();
    } catch {
      setWaveforms(
        Object.fromEntries(
          session.audio_segments.map((s) => [s.segment_id, null]),
        ),
      );
      return;
    }
    void (async () => {
      // Decode the original recording locally. No synthetic signal or transcription is used.
      for (const recorded of session.audio_segments) {
        try {
          const chunks = audio
            .filter((c) => c.segment_id === recorded.segment_id)
            .sort((a, b) => a.index - b.index);
          if (!chunks.length) throw new Error("No audio bytes");
          const decoded = await context.decodeAudioData(
            await new Blob(chunks.map((c) => c.blob)).arrayBuffer(),
          );
          if (cancelled) break;
          const samples = decoded.getChannelData(0);
          const count = 480;
          const peaks = Array.from({ length: count }, (_, index) => {
            const from = Math.floor((index * samples.length) / count);
            const to = Math.floor(((index + 1) * samples.length) / count);
            const stride = Math.max(1, Math.floor((to - from) / 256));
            let peak = 0;
            for (let i = from; i < to; i += stride)
              peak = Math.max(peak, Math.abs(samples[i]));
            return peak;
          });
          const maximum = Math.max(...peaks);
          setWaveforms((prior) => ({
            ...prior,
            [recorded.segment_id]:
              maximum > 0 ? peaks.map((p) => p / maximum) : peaks,
          }));
        } catch {
          if (!cancelled)
            setWaveforms((prior) => ({
              ...prior,
              [recorded.segment_id]: null,
            }));
        }
      }
    })().finally(() => {
      if (context.state !== "closed") void context.close().catch(() => {});
    });
    return () => {
      cancelled = true;
      if (context.state !== "closed") void context.close().catch(() => {});
    };
  }, [audio, session.audio_segments]);

  useEffect(() => {
    if (!activeEntryId || !transcriptEl.current) return;
    const container = transcriptEl.current;
    const element = container.querySelector<HTMLElement>(
      `[data-review-entry="${activeEntryId}"]`,
    );
    if (!element) return;
    const follow = () => {
      const bounds = element.getBoundingClientRect(),
        visible = container.getBoundingClientRect();
      if (bounds.top < visible.top || bounds.bottom > visible.bottom)
        container.scrollTo({
          top: container.scrollTop + bounds.top - visible.top - 12,
          behavior: "auto",
        });
    };
    follow();
    const observer = new ResizeObserver(follow);
    observer.observe(container);
    return () => observer.disconnect();
  }, [activeEntryId]);

  useEffect(() => {
    const viewport = timelineEl.current,
      track = timelineTrack.current;
    if (!viewport || !track) return;
    const follow = () => {
      const cursor =
        viewport.scrollLeft +
        track.getBoundingClientRect().left -
        viewport.getBoundingClientRect().left +
        (playhead / end) * track.clientWidth;
      if (
        cursor < viewport.scrollLeft + 30 ||
        cursor > viewport.scrollLeft + viewport.clientWidth - 30
      )
        viewport.scrollTo({
          left: Math.max(0, cursor - viewport.clientWidth / 2),
          behavior: "auto",
        });
    };
    follow();
    const observer = new ResizeObserver(follow);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [playhead, zoom, end]);

  useEffect(
    () => () => {
      if (windowTimer.current) clearTimeout(windowTimer.current);
      windowRun.current = null;
    },
    [],
  );
  const clearWindow = () => {
    if (windowTimer.current) clearTimeout(windowTimer.current);
    windowTimer.current = null;
    windowRun.current = null;
    pendingSeek.current = null;
    setWindowSelection(null);
  };
  const finishWindow = () => {
    if (windowTimer.current) clearTimeout(windowTimer.current);
    windowTimer.current = null;
    windowRun.current = null;
    audioEl.current?.pause();
    setWindowStatus("Finished");
  };
  const enforceWindow = () => {
    if (windowTimer.current) clearTimeout(windowTimer.current);
    windowTimer.current = null;
    const run = windowRun.current,
      player = audioEl.current;
    if (
      !run ||
      !player ||
      player.paused ||
      player.dataset.segmentId !== run.part.segment_id
    )
      return;
    const remaining = run.part.audio_end_seconds - player.currentTime;
    if (remaining <= 0.015 || player.ended) {
      finishWindow();
      return;
    }
    windowTimer.current = setTimeout(
      enforceWindow,
      Math.max(10, (remaining * 1000) / Math.max(0.1, player.playbackRate)),
    );
  };
  const playWindow = (
    window: ReviewWindow,
    requestId: string | null,
    partIndex = 0,
    context = includeContext,
  ) => {
    if (windowTimer.current) clearTimeout(windowTimer.current);
    windowRun.current = null;
    pendingSeek.current = null;
    audioEl.current?.pause();
    const playback = windowPlayback(
      snapshot,
      window,
      context ? 2000 : 0,
      windowData,
    );
    setWindowSelection({
      window_id: window.window_id,
      request_id: requestId,
      part_index: partIndex,
    });
    const part = playback.parts[partIndex];
    if (!part) {
      setWindowStatus("No recorded audio");
      return;
    }
    windowRun.current = { part };
    setWindowStatus("Loading");
    seekTime(part.start_t_ms, true, false, true);
    setNotice("");
  };
  const rangeOverlay =
    selectedWindow && selectedPlayback ? (
      <>
        <div
          className="timeline-window-context"
          style={spanStyle(
            selectedPlayback.start_t_ms,
            selectedPlayback.end_t_ms,
          )}
        />
        <div
          className="timeline-window-boundary"
          style={spanStyle(selectedWindow.start_t_ms, selectedWindow.end_t_ms)}
        />
      </>
    ) : null;

  const applySeek = (target: NonNullable<typeof pendingSeek.current>) => {
    const player = audioEl.current;
    if (!player) return;
    player.currentTime = target.position;
    if (target.autoplay)
      void player.play().catch((error) => {
        if (error.name !== "AbortError") {
          setNotice(errorText(error));
          if (windowRun.current) setWindowStatus("Playback failed");
        }
      });
  };
  const seekTime = (
    t: number,
    autoplay: boolean,
    finalSelection = false,
    preserveWindow = false,
  ) => {
    if (!preserveWindow) clearWindow();
    setSelectedFinal(finalSelection);
    const value = Math.max(0, Math.min(end, t));
    setPlayhead(value);
    const exchange = exchanges
      .filter((e) => e.human.created_t_ms <= value)
      .at(-1);
    setSelectedRequest(exchange?.human.request_id ?? "");
    const target =
      preserveWindow && windowRun.current
        ? session.audio_segments.find(
            (s) => s.segment_id === windowRun.current!.part.segment_id,
          )
        : session.audio_segments.find(
            (s) =>
              value >= s.started_t_ms &&
              value <= (s.ended_t_ms ?? session.last_t_ms),
          );
    const gap = audioGaps.find(
      (g) =>
        g.kind.startsWith("audio") &&
        value >= g.start_t_ms &&
        value < (g.end_t_ms ?? end),
    );
    const hasBytes =
      target &&
      audio.some((c) => c.segment_id === target.segment_id && c.size > 0);
    if (!target || gap || !hasBytes) {
      pendingSeek.current = null;
      audioEl.current?.pause();
      setNotice(
        "No recording is available at this session time. Recording gaps are not joined together.",
      );
      return;
    }
    const pending = {
      segmentId: target.segment_id,
      position: (value - target.started_t_ms) / 1000,
      autoplay,
    };
    if (target.segment_id !== segmentId && !autoplay) {
      audioEl.current?.pause();
    }
    setSegmentId(target.segment_id);
    if (
      source?.segmentId === target.segment_id &&
      audioEl.current &&
      audioEl.current.readyState >= 1
    )
      applySeek(pending);
    else pendingSeek.current = pending;
  };
  const seekMarker = (marker: Marker | undefined) => {
    clearWindow();
    if (!marker) {
      setNotice("No timestamp was recorded for this message.");
      return;
    }
    if (marker.request_id) setSelectedRequest(marker.request_id);
    if (marker.audio_position_seconds === null) {
      audioEl.current?.pause();
      pendingSeek.current = null;
      setPlayhead(marker.t_ms);
      setSelectedFinal(marker.type === "final_submitted");
      setNotice(
        `No recording position is available for this event (${marker.mapping_status}).`,
      );
      return;
    }
    seekTime(marker.t_ms, true, marker.type === "final_submitted");
    setNotice(
      `${marker.label}: session ${time(marker.t_ms, 3)} → recording ${marker.audio_position_seconds.toFixed(3)} s.${marker.mapping_status === "uncertain" ? " Capture continuity is uncertain." : ""}`,
    );
  };
  const aiStart = (requestId: string) =>
    markers.find(
      (m) => m.request_id === requestId && m.type === "ai_first_display",
    ) ??
    markers.find(
      (m) => m.request_id === requestId && m.type === "ai_first_text_received",
    ) ??
    markers.find(
      (m) => m.request_id === requestId && m.type === "ai_request_started",
    );
  const displayedPhases =
    selected?.markers.filter((m) =>
      [
        "prompt_sent",
        "ai_request_dispatched",
        "ai_first_text_received",
        "ai_first_display",
        "ai_completed",
        "ai_interrupted",
        "ai_failed",
      ].includes(m.type),
    ) ?? [];

  return (
    <section className="review" aria-label="Session review">
      <div className="review-heading">
        <div>
          <h2>Session review</h2>
          <p>
            {session.config.task.title} · Participant {session.participant_id}
          </p>
        </div>
        <div className="review-summary">
          <span>
            Exchanges: {exchanges.length} · {time(end, 0)}
          </span>
          <small>{session.config.model}</small>
        </div>
      </div>
      <div className="review-grid">
        <section className="review-conversation" aria-label="Conversation log">
          <div className="review-panel-heading">
            <h3>Conversation</h3>
            <span>Human prompts and AI responses</span>
          </div>
          <div className="review-window-options">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={includeContext}
                onChange={(e) => {
                  const next = e.target.checked;
                  setIncludeContext(next);
                  if (selectedWindow)
                    playWindow(
                      selectedWindow,
                      windowSelection?.request_id ?? null,
                      0,
                      next,
                    );
                }}
              />
              Include up to 2 s before and after each window
            </label>
            <p>
              Review intervals use event timestamps. They do not define research
              moves or speech boundaries.
            </p>
            {!exchanges.length && windowData.windows[0] && (
              <button
                onClick={() => playWindow(windowData.windows[0], null)}
                disabled={windowData.windows[0].duration_ms <= 0}
              >
                Play before-first-prompt audio
              </button>
            )}
          </div>
          <div className="review-transcript" ref={transcriptEl}>
            {!exchanges.length && (
              <p className="review-empty">No chat messages were sent.</p>
            )}
            {exchanges.map((exchange) => (
              <section
                className={`review-exchange ${selectedRequestForView === exchange.human.request_id ? "selected" : ""}`}
                key={exchange.human.request_id}
                data-request-id={exchange.human.request_id}
              >
                <div className="exchange-heading">
                  <h4>Exchange {exchange.number}</h4>
                  <span>{time(exchange.human.created_t_ms)}</span>
                </div>
                {windowData.exchanges.find(
                  (e) => e.request_id === exchange.human.request_id,
                ) && (
                  <AudioWindowControls
                    exchange={windowData.exchanges.find(
                      (e) => e.request_id === exchange.human.request_id,
                    )!}
                    windows={windowData.windows}
                    selectedId={windowSelection?.window_id ?? null}
                    onSelect={playWindow}
                  />
                )}
                {[exchange.human, exchange.ai]
                  .filter((m): m is Message => Boolean(m))
                  .map((message) => {
                    const human = message.role === "user";
                    const marker = human
                      ? exchange.markers.find((m) => m.type === "prompt_sent")
                      : aiStart(message.request_id);
                    return (
                      <article
                        className={`review-message ${human ? "human" : "assistant"} ${activeEntryId === message.message_id ? "at-playhead" : ""}`}
                        key={message.message_id}
                        data-message-id={message.message_id}
                        data-review-entry={message.message_id}
                      >
                        <div className="review-message-heading">
                          <strong>{human ? "Human" : "AI"}</strong>
                          <span className={`review-status ${message.status}`}>
                            {terminalLabels[message.status]}
                          </span>
                          <button
                            className="text-button"
                            aria-label={`Play ${human ? "Human message" : "AI response"} ${exchange.number}`}
                            onClick={() => seekMarker(marker)}
                          >
                            ▶ {time(marker?.t_ms ?? message.created_t_ms)}
                          </button>
                        </div>
                        <div className="review-message-text">
                          {message.content || "No response text was received."}
                        </div>
                        {!human && (
                          <div className="review-message-footnote">
                            {message.first_display_t_ms !== undefined
                              ? `First response ${time(message.first_display_t_ms)}`
                              : "No first response recorded"}
                            {message.ended_t_ms !== undefined
                              ? ` · End ${time(message.ended_t_ms)}`
                              : " · End time unknown"}
                          </div>
                        )}
                      </article>
                    );
                  })}
              </section>
            ))}
            <section
              className={`review-final ${atFinal ? "selected" : ""}`}
              data-review-entry="final-submission"
            >
              <div className="review-message-heading">
                <h3>Final submission</h3>
                {finalMarker && (
                  <button
                    className="text-button"
                    aria-label="Play final submission"
                    onClick={() => seekMarker(finalMarker)}
                  >
                    ▶ {time(finalMarker.t_ms)}
                  </button>
                )}
              </div>
              <div className="review-message-text">
                {session.final_answer ?? "No final plan was submitted."}
              </div>
            </section>
          </div>
        </section>

        <section
          className="review-recording"
          aria-label="Recording and timeline"
        >
          <div className="review-panel-heading">
            <h3>Microphone timeline</h3>
            <span>Continuous think-aloud recording</span>
          </div>
          <div className="review-player">
            <div className="review-clock">
              <strong>Session {time(playhead)}</strong>
              <span>
                {hasPlaybackPosition && segment
                  ? `Recording ${session.audio_segments.indexOf(segment) + 1} · ${time(Math.max(0, playhead - segment.started_t_ms))}`
                  : "No recording at this time"}
              </span>
            </div>
            {session.audio_segments.length > 1 && (
              <label className="segment-select">
                Recording segment
                <select
                  value={segmentId}
                  onChange={(event) => {
                    const next = session.audio_segments.find(
                      (s) => s.segment_id === event.target.value,
                    );
                    if (next) {
                      setNotice("");
                      seekTime(next.started_t_ms, false);
                    }
                  }}
                >
                  {session.audio_segments.map((s, index) => (
                    <option value={s.segment_id} key={s.segment_id}>
                      Recording {index + 1} · {time(s.started_t_ms)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {source ? (
              <audio
                key={source.segmentId}
                ref={audioEl}
                src={source.url}
                data-segment-id={source.segmentId}
                controls
                preload="metadata"
                aria-label="Session recording playback"
                onPointerDown={() => {
                  setSelectedFinal(false);
                  clearWindow();
                }}
                onKeyDown={() => {
                  setSelectedFinal(false);
                  clearWindow();
                }}
                onPlay={() => {
                  if (windowRun.current) {
                    setWindowStatus("Playing");
                    enforceWindow();
                  }
                }}
                onPause={() => {
                  if (windowTimer.current) clearTimeout(windowTimer.current);
                  if (windowRun.current) setWindowStatus("Paused");
                }}
                onEnded={() => {
                  if (windowRun.current) finishWindow();
                }}
                onRateChange={enforceWindow}
                onSeeked={enforceWindow}
                onLoadedMetadata={() => {
                  const pending = pendingSeek.current;
                  if (pending?.segmentId === source.segmentId) {
                    pendingSeek.current = null;
                    applySeek(pending);
                  }
                }}
                onTimeUpdate={(event) => {
                  if (source.segmentId !== segmentId) return;
                  enforceWindow();
                  const recorded = session.audio_segments.find(
                    (s) => s.segment_id === source.segmentId,
                  );
                  if (!recorded) return;
                  const t = Math.min(
                    end,
                    recorded.started_t_ms +
                      event.currentTarget.currentTime * 1000,
                  );
                  setPlayhead(t);
                  const exchange = exchanges
                    .filter((e) => e.human.created_t_ms <= t)
                    .at(-1);
                  setSelectedRequest(exchange?.human.request_id ?? "");
                }}
                onError={() => {
                  if (windowRun.current) {
                    if (windowTimer.current) clearTimeout(windowTimer.current);
                    windowRun.current = null;
                    setWindowStatus("Playback failed");
                  }
                  setNotice(
                    "This recording could not be played by the browser. The original audio remains in the session ZIP.",
                  );
                }}
              />
            ) : (
              <p className="review-empty">
                No audio bytes are available for this recording.
              </p>
            )}
            <label className="review-seek-label">
              Session position
              <input
                type="range"
                min={0}
                max={end}
                step={10}
                value={playhead}
                aria-label="Seek session recording"
                aria-valuetext={time(playhead)}
                onChange={(event) => {
                  setNotice("");
                  seekTime(Number(event.target.value), false);
                }}
              />
            </label>
          </div>
          {selectedWindow && selectedPlayback && (
            <section
              className="review-window-selection"
              aria-label="Selected audio window"
              data-window-id={selectedWindow.window_id}
            >
              <div className="window-selection-heading">
                <strong>{selectedWindow.label}</strong>
                <span className="window-playback-state">{windowStatus}</span>
              </div>
              <dl>
                <div>
                  <dt>Event boundaries</dt>
                  <dd>
                    {time(selectedWindow.start_t_ms, 3)} →{" "}
                    {time(selectedWindow.end_t_ms, 3)}
                  </dd>
                </div>
                <div>
                  <dt>Playback range</dt>
                  <dd>
                    {time(selectedPlayback.start_t_ms, 3)} →{" "}
                    {time(selectedPlayback.end_t_ms, 3)}
                  </dd>
                </div>
              </dl>
              {selectedWindow.censored && (
                <p className="window-warning">
                  An ending was not observed. This interval stops at the next
                  recorded boundary.
                </p>
              )}
              {selectedPlayback.unavailable.length > 0 && (
                <p className="window-warning">
                  This range contains unrecorded or muted time. Each recorded
                  part stops separately; gaps are not joined.
                </p>
              )}
              {!selectedPlayback.parts.length && (
                <p className="window-warning">
                  No recorded audio is available in this range.
                </p>
              )}
              {selectedPlayback.parts.some(
                (part) => part.mapping_status === "uncertain",
              ) && (
                <p className="window-warning">
                  Recording continuity or its ending is uncertain. Times are
                  approximate.
                </p>
              )}
              {selectedPlayback.parts.length > 1 && (
                <div className="window-parts">
                  {selectedPlayback.parts.map((part, index) => (
                    <button
                      key={`${part.segment_id}-${part.start_t_ms}`}
                      aria-label={`Play recorded part ${index + 1}`}
                      onClick={() =>
                        playWindow(
                          selectedWindow,
                          windowSelection?.request_id ?? null,
                          index,
                        )
                      }
                      aria-pressed={windowSelection?.part_index === index}
                    >
                      Part {index + 1} · {time(part.start_t_ms)}–
                      {time(part.end_t_ms)}
                    </button>
                  ))}
                </div>
              )}
              <div className="window-playback-actions">
                <button
                  onClick={() =>
                    playWindow(
                      selectedWindow,
                      windowSelection?.request_id ?? null,
                      windowSelection?.part_index ?? 0,
                    )
                  }
                  disabled={!selectedPlayback.parts.length}
                >
                  Replay window
                </button>
                <button
                  onClick={() => {
                    if (windowTimer.current) clearTimeout(windowTimer.current);
                    windowRun.current = null;
                    pendingSeek.current = null;
                    audioEl.current?.pause();
                    setWindowStatus("Stopped");
                  }}
                  disabled={!windowRun.current}
                >
                  Stop window playback
                </button>
              </div>
            </section>
          )}
          <div className="timeline-toolbar">
            <span>All times from session start</span>
            <label>
              Zoom{" "}
              <select
                aria-label="Timeline zoom"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              >
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={4}>4×</option>
              </select>
            </label>
          </div>
          <div className="review-timeline-scroll" ref={timelineEl}>
            <div
              className="review-timeline"
              style={{ width: `${zoom * 100}%` }}
            >
              <div className="timeline-ruler">
                <span />{" "}
                <div>
                  {Array.from({ length: 5 }, (_, index) => (
                    <span key={index} style={{ left: `${index * 25}%` }}>
                      {time((end * index) / 4, 0)}
                    </span>
                  ))}
                </div>
              </div>
              <div className="timeline-lane">
                <strong>Mic</strong>
                <div
                  className="timeline-track microphone-track"
                  ref={timelineTrack}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    seekTime(
                      ((event.clientX - rect.left) / rect.width) * end,
                      true,
                    );
                  }}
                >
                  {session.audio_segments.map((recorded, index) => (
                    <div
                      className={`timeline-recording ${recorded.ended_t_ms === undefined ? "uncertain" : ""}`}
                      key={recorded.segment_id}
                      style={spanStyle(
                        recorded.started_t_ms,
                        recorded.ended_t_ms ?? session.last_t_ms,
                      )}
                      title={`Recording ${index + 1}: ${time(recorded.started_t_ms)}–${time(recorded.ended_t_ms ?? session.last_t_ms)}`}
                    >
                      {waveforms[recorded.segment_id] ? (
                        <svg
                          className="recording-waveform"
                          viewBox="0 0 480 32"
                          preserveAspectRatio="none"
                          aria-label={`Waveform for recording ${index + 1}`}
                        >
                          <path
                            d={waveforms[recorded.segment_id]!.map(
                              (peak, i) =>
                                `M${i},${16 - peak * 16}V${16 + peak * 16}`,
                            ).join(" ")}
                          />
                        </svg>
                      ) : (
                        <span>
                          {waveforms[recorded.segment_id] === null
                            ? "Waveform unavailable"
                            : "Loading waveform…"}
                        </span>
                      )}
                    </div>
                  ))}
                  {audioGaps.map((gap, index) => (
                    <div
                      className={`timeline-gap ${gap.kind.startsWith("audio") ? "" : "uncertain"}`}
                      style={spanStyle(gap.start_t_ms, gap.end_t_ms ?? end)}
                      key={index}
                      title={`${gap.reason}: ${time(gap.start_t_ms)}–${time(gap.end_t_ms ?? end)}`}
                    >
                      <span>
                        {gap.kind.startsWith("audio") ? "Gap" : "Uncertain"}
                      </span>
                    </div>
                  ))}
                  {rangeOverlay}
                  <i
                    className="timeline-playhead"
                    style={{ left: position(playhead) }}
                  />
                </div>
              </div>
              <div className="timeline-lane">
                <strong>Human</strong>
                <div className="timeline-track human-track">
                  {markers
                    .filter(
                      (m) =>
                        m.type === "prompt_sent" ||
                        m.type === "final_submitted",
                    )
                    .map((marker) => (
                      <button
                        className={`timeline-marker ${marker.request_id === selectedRequestForView ? "selected" : ""} ${marker.type === "final_submitted" ? "final" : ""}`}
                        key={marker.event_id}
                        style={{ left: position(marker.t_ms) }}
                        aria-label={
                          marker.type === "prompt_sent"
                            ? `Jump to human message ${marker.turn_index}`
                            : "Jump to final answer"
                        }
                        title={`${marker.label} · ${time(marker.t_ms, 3)}`}
                        onClick={() => seekMarker(marker)}
                      >
                        {marker.type === "final_submitted"
                          ? "F"
                          : marker.turn_index}
                      </button>
                    ))}
                  {rangeOverlay}
                  <i
                    className="timeline-playhead"
                    style={{ left: position(playhead) }}
                  />
                </div>
              </div>
              <div className="timeline-lane">
                <strong>AI</strong>
                <div className="timeline-track ai-track">
                  {exchanges.map((exchange) => {
                    const ai = exchange.ai;
                    if (!ai) return null;
                    const start = exchange.human.created_t_ms;
                    const first = ai.first_display_t_ms;
                    const stop = ai.ended_t_ms ?? session.last_t_ms;
                    return (
                      <div key={ai.message_id}>
                        <button
                          className={`timeline-phase waiting-phase ${selectedRequestForView === ai.request_id ? "selected" : ""}`}
                          style={spanStyle(start, first ?? stop)}
                          aria-label={`Jump to AI waiting ${exchange.number}`}
                          title={`Exchange ${exchange.number} · Waiting ${time(start)}–${time(first ?? stop)}`}
                          onClick={() =>
                            seekMarker(
                              exchange.markers.find(
                                (m) => m.type === "prompt_sent",
                              ),
                            )
                          }
                        >
                          <span>Waiting</span>
                        </button>
                        {first !== undefined && (
                          <button
                            className={`timeline-phase response-phase ${ai.status} ${selectedRequestForView === ai.request_id ? "selected" : ""}`}
                            style={spanStyle(first, stop)}
                            aria-label={`Jump to AI response ${exchange.number}`}
                            title={`Exchange ${exchange.number} · Response ${time(first)}–${time(stop)} · ${terminalLabels[ai.status]}`}
                            onClick={() => seekMarker(aiStart(ai.request_id))}
                          >
                            <span>Response {exchange.number}</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {rangeOverlay}
                  <i
                    className="timeline-playhead"
                    style={{ left: position(playhead) }}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="timeline-legend">
            <span>
              <i className="legend-mic" />
              Recorded audio
            </span>
            <span>
              <i className="legend-wait" />
              AI waiting
            </span>
            <span>
              <i className="legend-response" />
              AI response
            </span>
            {selectedWindow && (
              <span>
                <i className="legend-window" />
                Window boundary · dashed edges: playback context
              </span>
            )}
            {audioGaps.length > 0 && (
              <span>
                <i className="legend-gap" />
                Gap / uncertain
              </span>
            )}
          </div>
          <p className="timeline-help">
            Select a message, numbered marker, or waveform to listen from that
            time. Waiting includes network and model processing; internal
            generation start is not observed. Audio alignment is approximate.
            Waveform amplitude is scaled for readability.
          </p>
          {notice && (
            <p className="review-notice" role="status">
              {notice}
            </p>
          )}
          <TranscriptionPanel
            snapshot={snapshot}
            playhead={playhead}
            onSeek={(t) => seekTime(t, true)}
          />
          {selected && (
            <section
              className="exchange-timings"
              aria-label={`Exchange ${selected.number} timing`}
            >
              <h4>Exchange {selected.number} timing</h4>
              <dl>
                {displayedPhases.map((marker) => (
                  <div key={marker.event_id}>
                    <dt>{marker.label}</dt>
                    <dd>
                      <button
                        className="text-button"
                        disabled={marker.audio_position_seconds === null}
                        title={marker.definition}
                        onClick={() => seekMarker(marker)}
                      >
                        {time(marker.t_ms, 3)}
                      </button>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          <details className="review-event-details">
            <summary>All event timings ({markers.length})</summary>
            <div className="review-event-table">
              <table>
                <thead>
                  <tr>
                    <th>Session time</th>
                    <th>Event</th>
                    <th>Recording position</th>
                  </tr>
                </thead>
                <tbody>
                  {markers.map((marker) => (
                    <tr key={marker.event_id}>
                      <td>
                        <button
                          className="text-button"
                          disabled={marker.audio_position_seconds === null}
                          onClick={() => seekMarker(marker)}
                        >
                          {time(marker.t_ms, 3)}
                        </button>
                      </td>
                      <td>
                        {marker.turn_index ? `${marker.turn_index} · ` : ""}
                        {marker.label}
                      </td>
                      <td>
                        {marker.audio_position_seconds === null
                          ? marker.mapping_status
                          : `${marker.audio_position_seconds.toFixed(3)} s`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      </div>
    </section>
  );
}
