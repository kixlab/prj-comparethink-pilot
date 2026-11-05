import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  Configuration,
  Message,
  Session,
  Snapshot,
  TaskCatalog,
} from "./types";
import {
  errorText,
  id,
  instructions,
  instructionsForTask,
  requestMicrophone,
} from "./types";
import TravelTaskPanel from "./TravelTaskPanel";
import { SessionEngine } from "./engine";
import SessionReview from "./SessionReview";
import {
  listSessions,
  loadSnapshot,
  openDatabase,
  loadTranscriptions,
  unsavedTranscriptionIds,
  transcriptionReadError,
} from "./storage";
import { buildArchive, downloadArchive, messagesFromEvents } from "./export";

const blockLabels: Record<string, string> = {
  red: "Red",
  blue: "Blue",
  yellow: "Yellow",
  orange: "Orange",
};
const seconds = (ms: number) =>
  `${Math.floor(ms / 60000)
    .toString()
    .padStart(2, "0")}:${Math.floor((ms / 1000) % 60)
    .toString()
    .padStart(2, "0")}`;
function TaskPanel({ config }: { config: Configuration }) {
  const task = config.task;
  if (task.kind === "travelplanner") return <TravelTaskPanel task={task} />;
  return (
    <aside className="task-panel">
      <h2>{task.title}</h2>
      <p>{task.description}</p>
      <h3>Initial state</h3>
      <div className="blocks" aria-label="Initial block arrangement">
        {task.initial_stacks.map((stack, i) => (
          <div key={i}>
            {[...stack].reverse().map((color) => (
              <span key={color} className={`block ${color}`}>
                {blockLabels[color] ?? color}
              </span>
            ))}
          </div>
        ))}
        <span className="table-label">Table</span>
      </div>
      <ul className="state-list">
        {task.initial_state.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <div className="goal">
        <div className="eyebrow">Goal state</div>
        {task.goal_state.map((s) => (
          <strong key={s}>{s}</strong>
        ))}
      </div>
      <h3>Action rules</h3>
      <div className="action-list">
        {task.actions.map((a) => (
          <div key={a.name}>
            <div>
              <strong>{a.label}</strong>
              <code>{a.name}</code>
            </div>
            <p>{a.rule}</p>
          </div>
        ))}
      </div>
      <ul className="state-list">
        {task.rules.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <details className="source">
        <summary>Task source and original wording</summary>
        <p>
          PlanBench · task_1_plan_generation · instance{" "}
          {task.source.instance_id}. The rules and target problem are shown
          below. The separate example and reference solution are excluded.
        </p>
        <pre>{task.original.rules}</pre>
        <p>{task.original.initial_state}</p>
        <p>{task.original.goal_state}</p>
      </details>
    </aside>
  );
}
function ChatMessage({
  message,
  engine,
}: {
  message: Message;
  engine: SessionEngine;
}) {
  useLayoutEffect(() => {
    if (message.role === "assistant" && message.content) {
      const frame = requestAnimationFrame(() =>
        engine.observePaint(message.message_id),
      );
      return () => cancelAnimationFrame(frame);
    }
  }, [message.message_id, Boolean(message.content), engine]);
  const status = {
    streaming: "Responding",
    completed: "Completed",
    interrupted: "Interrupted · received text retained",
    failed: "Failed · received text retained",
    sent: "Sent",
  }[message.status];
  return (
    <article
      className={`message ${message.role}`}
      data-message-id={message.message_id}
    >
      <div className="message-meta">
        <strong>{message.role === "user" ? "You" : "AI"}</strong>
        <time>{seconds(message.created_t_ms)}</time>
        <span>{status}</span>
      </div>
      <div className="message-text">
        {message.content ||
          (message.status === "streaming" ? (
            <span className="waiting">
              Waiting for a response<span>…</span>
            </span>
          ) : (
            "No text was received."
          ))}
      </div>
    </article>
  );
}
export default function App() {
  const [config, setConfig] = useState<Configuration | null>(null);
  const [catalog, setCatalog] = useState<TaskCatalog | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [phase, setPhase] = useState<"mic" | "guide" | "active" | "done">(
    "mic",
  );
  const [error, setError] = useState("");
  const [participant, setParticipant] = useState(() => `p-${id().slice(0, 8)}`);
  const [micState, setMicState] = useState<"idle" | "recording" | "ready">(
    "idle",
  );
  const [testUrl, setTestUrl] = useState("");
  const [micConfirmed, setMicConfirmed] = useState(false);
  const [level, setLevel] = useState(0);
  const [working, setWorking] = useState(false);
  const [engine, setEngine] = useState<SessionEngine | null>(null);
  const [, rerender] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [finalAnswer, setFinalAnswer] = useState("");
  const [showFinal, setShowFinal] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [saved, setSaved] = useState<Session[]>([]);
  const [review, setReview] = useState<Snapshot | null>(null);
  const testRecorder = useRef<MediaRecorder | null>(null);
  const composing = useRef(false);
  const micErrors = useRef<{ at_utc: string; error: string }[]>([]);
  const chatBottom = useRef<HTMLDivElement>(null);
  const refreshSessions = () =>
    listSessions()
      .then(setSaved)
      .catch((e) => setError(`Storage error: ${errorText(e)}`));
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/tasks")
      .then(async (r) => {
        if (!r.ok) throw new Error("Could not load the available tasks.");
        return r.json() as Promise<TaskCatalog>;
      })
      .then((available) => {
        if (cancelled) return;
        setCatalog(available);
        const requested = new URLSearchParams(window.location.search).get(
          "task",
        );
        const initial = requested
          ? available.tasks.find(
              (task) => task.task_id === requested || task.kind === requested,
            )
          : available.tasks.find(
              (task) => task.task_id === available.default_task_id,
            );
        if (initial) setSelectedTaskId(initial.task_id);
        else setError("Unknown task in the URL. Select a task below.");
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      });
    void openDatabase()
      .then(refreshSessions)
      .catch((e) => setError(`Storage error: ${errorText(e)}`));
    return () => {
      cancelled = true;
      const recorder = testRecorder.current;
      if (recorder?.state === "recording") recorder.stop();
    };
  }, []);
  useEffect(() => {
    if (!selectedTaskId) return;
    const controller = new AbortController();
    setConfig(null);
    void fetch(`/api/config?task_id=${encodeURIComponent(selectedTaskId)}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Could not load the selected task.");
        return r.json() as Promise<Configuration>;
      })
      .then((selected) => {
        if (!controller.signal.aborted) setConfig(selected);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorText(e));
      });
    return () => controller.abort();
  }, [selectedTaskId]);
  useEffect(() => {
    if (!testUrl) return;
    return () => URL.revokeObjectURL(testUrl);
  }, [testUrl]);
  useEffect(() => {
    if (!engine || phase !== "active") return;
    const timer = setInterval(
      () => setElapsed(engine.now() - (engine.session.task_started_t_ms ?? 0)),
      250,
    );
    return () => clearInterval(timer);
  }, [engine, phase]);
  const unsavedWrites = engine?.journal.pending.length ?? 0;
  useEffect(() => {
    if (phase !== "done" || !unsavedWrites) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [phase, unsavedWrites]);
  const messages = engine?.messages ?? [];
  const lastMessage = messages.at(-1);
  useEffect(() => {
    chatBottom.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [lastMessage?.content, messages.length]);
  async function testMic() {
    setError("");
    setWorking(true);
    setMicConfirmed(false);
    setTestUrl("");
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      if (!navigator.mediaDevices || typeof MediaRecorder === "undefined")
        throw new Error(
          "Use a browser with recording support over HTTPS or localhost.",
        );
      stream = await requestMicrophone();
      context = new AudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(stream),
        analyser = context.createAnalyser();
      source.connect(analyser);
      analyser.fftSize = 256;
      const data = new Uint8Array(analyser.fftSize);
      const meter = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        setLevel(
          Math.min(
            100,
            Math.sqrt(
              data.reduce((n, v) => n + ((v - 128) / 128) ** 2, 0) /
                data.length,
            ) * 500,
          ),
        );
      }, 100);
      const recorder = new MediaRecorder(stream);
      const blobs: Blob[] = [];
      testRecorder.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size) blobs.push(e.data);
      };
      recorder.onstop = () => {
        clearInterval(meter);
        setLevel(0);
        stream?.getTracks().forEach((t) => t.stop());
        void context?.close();
        const blob = new Blob(blobs, { type: recorder.mimeType });
        if (!blob.size) {
          setError("The test recording is empty. Please try again.");
          setMicState("idle");
          return;
        }
        setTestUrl(URL.createObjectURL(blob));
        setMicState("ready");
      };
      recorder.onerror = () => {
        setError("An error occurred during the microphone test.");
        if (recorder.state !== "inactive") recorder.stop();
      };
      recorder.start();
      setMicState("recording");
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      void context?.close();
      micErrors.current.push({
        at_utc: new Date().toISOString(),
        error: errorText(e),
      });
      setError(`Microphone unavailable: ${errorText(e)}`);
      setMicState("idle");
    } finally {
      setWorking(false);
    }
  }
  async function begin() {
    if (!config || working) return;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(participant)) {
      setError(
        "Use 1–64 letters, numbers, underscores, or hyphens for the participant ID.",
      );
      return;
    }
    setWorking(true);
    setError("");
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const launch = async () => {
      const current = new SessionEngine(participant, config, () =>
        rerender((v) => v + 1),
      );
      setEngine(current);
      current.log("microphone_test_confirmed", {
        playback_confirmed: micConfirmed,
        preflight_errors: micErrors.current,
      });
      try {
        await current.start();
        setPhase("active");
      } catch (e) {
        setError(errorText(e));
        setPhase("done");
        setReview(current.snapshot);
        release();
      } finally {
        setWorking(false);
      }
    };
    // Prevent two recorder sessions across tabs on browsers supporting Web Locks.
    if (navigator.locks) {
      void navigator.locks
        .request(
          "comparethink-capture",
          { ifAvailable: true },
          async (lock) => {
            if (!lock) {
              setError(
                "A session is running in another tab. End that session before starting a new one.",
              );
              setWorking(false);
              return;
            }
            releaseLock.current = release;
            await launch();
            await held;
          },
        )
        .catch((e) => {
          setError(errorText(e));
          setWorking(false);
        });
    } else {
      releaseLock.current = release;
      await launch();
    }
  }
  const releaseLock = useRef<() => void>(() => {});
  async function finish(answer?: string) {
    if (!engine) return;
    setWorking(true);
    setError("");
    try {
      await engine.finish(answer);
      setPhase("done");
      setReview({ ...engine.snapshot });
      await refreshSessions();
    } catch (e) {
      setError(errorText(e));
    } finally {
      releaseLock.current();
      setWorking(false);
    }
  }
  async function exportSession(snapshot: Snapshot, current = false) {
    setWorking(true);
    setError("");
    try {
      if (current && engine) {
        engine.log("export_requested");
        await engine.journal.flush();
      }
      const exported = { ...snapshot };
      try {
        exported.transcriptions = await loadTranscriptions(
          snapshot.session.session_id,
        );
        exported.transcription_read_error = transcriptionReadError(
          snapshot.session.session_id,
        );
      } catch (e) {
        exported.transcription_read_error = errorText(e);
      }
      exported.unsaved_transcription_ids = unsavedTranscriptionIds(
        snapshot.session.session_id,
      );
      const data = await buildArchive(
        exported,
        current ? (engine?.journal.pending.length ?? 0) : 0,
      );
      downloadArchive(data, snapshot.session.session_id);
    } catch (e) {
      if (current) engine?.log("export_error", { error: errorText(e) });
      setError(
        `Could not prepare the download: ${errorText(e)}. You can retry from Saved sessions.`,
      );
    } finally {
      setWorking(false);
    }
  }
  const send = () => {
    if (
      !engine ||
      !prompt.trim() ||
      engine.busy ||
      composing.current ||
      engine.journal.blocked ||
      !engine.audioHealthy ||
      engine.ending
    )
      return;
    const text = prompt;
    setPrompt("");
    void engine.send(text);
  };
  const steps = ["Setup", "Instructions", "Task", "Complete"];
  const phaseNumber = { mic: 0, guide: 1, active: 2, done: 3 }[phase];
  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            if (phase === "active" || engine?.journal.pending.length)
              e.preventDefault();
          }}
        >
          CompareThink
        </a>
        <span className="header-note">Planning study</span>
      </header>
      <nav className="progress" aria-label="Study progress">
        {steps.map((s, i) => (
          <div
            className={
              i === phaseNumber ? "current" : i < phaseNumber ? "past" : ""
            }
            aria-current={i === phaseNumber ? "step" : undefined}
            key={s}
          >
            <span>{i + 1}.</span>
            {s}
          </div>
        ))}
      </nav>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {phase === "mic" && (
        <main className="onboarding">
          <section className="setup-card">
            <h1>Session setup</h1>
            <label htmlFor="study-task">Task</label>
            <select
              id="study-task"
              aria-label="Task"
              value={selectedTaskId}
              disabled={!catalog || working || micState === "recording"}
              onChange={(e) => {
                setConfig(null);
                setError("");
                setSelectedTaskId(e.target.value);
                const option = catalog?.tasks.find(
                  (task) => task.task_id === e.target.value,
                );
                const url = new URL(window.location.href);
                url.searchParams.set("task", option?.kind ?? e.target.value);
                history.replaceState(null, "", url);
              }}
            >
              {!catalog || !selectedTaskId ? (
                <option value="">
                  {catalog ? "Select a task" : "Loading tasks…"}
                </option>
              ) : null}
              {catalog?.tasks.map((task) => (
                <option key={task.task_id} value={task.task_id}>
                  {task.title}
                </option>
              ))}
            </select>
            <p className="task-summary">
              {catalog?.tasks.find((task) => task.task_id === selectedTaskId)
                ?.summary ?? ""}
            </p>
            <h2>Microphone check</h2>
            <p>
              Record a short sample, then play it back to check that your voice
              is audible.
            </p>
            <label>
              Participant ID
              <input
                aria-label="Participant ID"
                value={participant}
                onChange={(e) => setParticipant(e.target.value)}
                maxLength={64}
                autoComplete="off"
              />
              <small>Do not enter your name or contact details.</small>
            </label>
            <div
              className={`mic-test ${micState === "recording" ? "live" : ""}`}
            >
              <strong>
                {micState === "recording"
                  ? "Test recording in progress"
                  : micState === "ready"
                    ? "Test recording ready"
                    : "Microphone not tested"}
              </strong>
              <div className="level-track">
                <i style={{ width: `${level}%` }} />
              </div>
              <small>
                {micState === "recording"
                  ? "Speak a sentence or two."
                  : "The test recording is not included in the study data."}
              </small>
            </div>
            {micState === "recording" ? (
              <button
                className="secondary full"
                onClick={() => testRecorder.current?.stop()}
              >
                Stop test recording
              </button>
            ) : (
              <button
                className="secondary full"
                disabled={working}
                onClick={() => void testMic()}
              >
                {micState === "ready"
                  ? "Test microphone again"
                  : "Start microphone test"}
              </button>
            )}
            {testUrl && (
              <>
                <audio
                  aria-label="Microphone test playback"
                  src={testUrl}
                  controls
                />
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={micConfirmed}
                    onChange={(e) => setMicConfirmed(e.target.checked)}
                  />
                  I played the recording and could hear my voice.
                </label>
              </>
            )}
            <button
              className="primary full"
              disabled={
                !micConfirmed || !config || working || micState === "recording"
              }
              onClick={() => {
                setError("");
                setPhase("guide");
              }}
            >
              Continue to instructions
            </button>
          </section>
        </main>
      )}
      {phase === "guide" && config && (
        <main className="guide-grid">
          <TaskPanel config={config} />
          <section className="guide-main">
            <h1>Instructions</h1>
            <div className="instruction-card">
              <div>
                <h3>Task and chat</h3>
                <p>{instructionsForTask(config.task).task}</p>
              </div>
            </div>
            <div className="instruction-card">
              <div>
                <h3>Think-aloud instructions</h3>
                <p>{instructions.think_aloud}</p>
              </div>
            </div>
            <div className="instruction-card">
              <div>
                <h3>Submit your final plan</h3>
                <p>{config.task.final_instruction}</p>
              </div>
            </div>
            <div className="notice">{instructions.audio_notice}</div>
            {!config.api_ready && (
              <div className="alert">
                The AI service is not configured. Please contact the researcher.
              </div>
            )}
            <button
              className="primary"
              disabled={working || !config.api_ready}
              onClick={() => void begin()}
            >
              {working ? "Preparing recording…" : "Start task"}
            </button>
            <button
              className="text-button"
              disabled={working}
              onClick={() => setPhase("mic")}
            >
              Check microphone again
            </button>
          </section>
        </main>
      )}
      {phase === "active" && engine && (
        <>
          <div className="session-bar">
            <div>
              <span
                className={`record-dot ${engine.audioHealthy ? "live" : ""}`}
              />
              <strong>
                {engine.audioHealthy ? "Recording" : "Recording stopped"}
              </strong>
              <span className="elapsed">{seconds(elapsed)}</span>
            </div>
            <span>Participant: {engine.session.participant_id}</span>
            <span className="session-task">
              Task: {engine.session.config.task.title}
            </span>
            <span className="save-state">
              {engine.journal.blocked
                ? "Storage error · retained in memory"
                : engine.journal.pending.length
                  ? "Saving…"
                  : "Saved locally"}
            </span>
          </div>
          {engine.journal.blocked && (
            <div className="alert error">
              New messages are disabled because local storage failed. Keep this
              tab open and retry saving or download the current record.
              <button onClick={() => void engine.retryStorage()}>
                Retry saving
              </button>
              <button onClick={() => void exportSession(engine.snapshot, true)}>
                Download current record
              </button>
            </div>
          )}
          {!engine.audioHealthy && (
            <div className="alert error">
              Recording stopped. The missing interval will remain in the study
              record.
              <button
                onClick={() =>
                  void engine
                    .restartRecording()
                    .catch((e) => setError(errorText(e)))
                }
              >
                Reconnect microphone
              </button>
            </div>
          )}
          <main className="workspace">
            <TaskPanel config={engine.session.config} />
            <section className="chat-panel">
              <div className="chat-heading">
                <div>
                  <h2>Chat</h2>
                </div>
                <span className="model-label">
                  {engine.session.config.model}
                </span>
              </div>
              <div
                className="chat-history"
                aria-label="Chat history"
                aria-live="polite"
              >
                {messages.length === 0 && (
                  <div className="empty-chat">
                    <h3>No messages yet.</h3>
                    <p>You may chat with the AI freely.</p>
                  </div>
                )}
                {messages.map((m) => (
                  <ChatMessage key={m.message_id} message={m} engine={engine} />
                ))}
                <div ref={chatBottom} />
              </div>
              <div className="composer">
                <label htmlFor="chat-input" className="sr-only">
                  Message to AI
                </label>
                <textarea
                  id="chat-input"
                  value={prompt}
                  placeholder="Type a message…"
                  disabled={engine.ending}
                  onChange={(e) => setPrompt(e.currentTarget.value)}
                  onCompositionStart={() => {
                    composing.current = true;
                  }}
                  onCompositionEnd={() => {
                    composing.current = false;
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing &&
                      !composing.current &&
                      e.nativeEvent.keyCode !== 229
                    ) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                <div className="composer-footer">
                  <small>Enter to send · Shift+Enter for a new line</small>
                  {engine.busy ? (
                    <button
                      className="secondary compact"
                      onClick={() => engine.cancel()}
                    >
                      Stop response
                    </button>
                  ) : (
                    <button
                      className="primary compact"
                      disabled={
                        !prompt.trim() ||
                        !engine.audioHealthy ||
                        engine.journal.blocked ||
                        engine.ending
                      }
                      onClick={send}
                    >
                      Send
                    </button>
                  )}
                </div>
              </div>
              <div className="task-footer">
                <span>Submit your final plan separately from the chat.</span>
                <button
                  className="secondary"
                  onClick={() => setShowFinal(!showFinal)}
                  disabled={engine.ending}
                >
                  {showFinal ? "Close final plan" : "Write final plan"}
                </button>
              </div>
              {showFinal && (
                <section className="final-panel">
                  <h3>Final plan</h3>
                  <p>{engine.session.config.task.final_instruction}</p>
                  <textarea
                    aria-label="Final plan"
                    rows={6}
                    value={finalAnswer}
                    onChange={(e) => setFinalAnswer(e.currentTarget.value)}
                    placeholder={
                      engine.session.config.task.kind === "travelplanner"
                        ? "Enter your day-by-day itinerary."
                        : "Enter the actions in order."
                    }
                  />
                  <button
                    className="primary"
                    disabled={!finalAnswer.trim() || working}
                    onClick={() => void finish(finalAnswer)}
                  >
                    Submit final plan and end session
                  </button>
                </section>
              )}
              <button
                className="text-button end-session"
                disabled={working}
                onClick={() => void finish()}
              >
                End session without submitting
              </button>
            </section>
          </main>
        </>
      )}
      {phase === "done" && engine && (
        <main className="completion">
          <div className="completion-heading">
            <div>
              <h1>Session ended</h1>
              <p>
                {engine.session.final_answer
                  ? "Review your conversation and think-aloud recording below."
                  : "The session ended without a final plan submission."}
              </p>
            </div>
            <div className="completion-actions">
              <button
                className="primary"
                disabled={working}
                onClick={() => void exportSession(engine.snapshot, true)}
              >
                Download session ZIP
              </button>
              <button
                className="secondary"
                onClick={() => window.location.reload()}
                disabled={engine.journal.pending.length > 0}
              >
                Prepare a new session
              </button>
            </div>
          </div>
          {engine.journal.blocked && (
            <div className="alert error" role="alert">
              Some data has not been saved and remains in this tab. Keep the tab
              open and retry saving or download the session ZIP.
            </div>
          )}
          <div
            className={`collection-result ${engine.session.collection_status === "complete" ? "" : "incomplete"}`}
          >
            <strong>
              {engine.session.collection_status === "complete"
                ? "Complete"
                : "Incomplete collection · errors or gaps recorded"}
            </strong>
            <span>
              Human prompts:{" "}
              {engine.messages.filter((m) => m.role === "user").length} · AI
              responses:{" "}
              {engine.messages.filter((m) => m.role === "assistant").length} ·
              Recordings: {engine.session.audio_segments.length}
            </span>
            {engine.session.issues.map((issue, i) => (
              <small key={i}>{issue}</small>
            ))}
          </div>
          {engine.journal.blocked && (
            <button
              className="secondary"
              onClick={() => void engine.retryStorage()}
            >
              Retry saving
            </button>
          )}
          {review && (
            <SessionReview key={review.session.session_id} snapshot={review} />
          )}
        </main>
      )}
      {saved.length > 0 && phase !== "active" && (
        <details className="saved-sessions" open={phase !== "done"}>
          <summary>Saved sessions ({saved.length})</summary>
          <div>
            <h2>Saved sessions</h2>
            <p>
              You can download saved sessions again. Unfinished sessions are
              exported as incomplete.
            </p>
          </div>
          {saved.map((s) => (
            <div className="saved-row" key={s.session_id}>
              <div>
                <strong>{s.participant_id}</strong>
                <small>{s.config.task.title}</small>
                <small>
                  {new Date(s.clock.origin_utc).toLocaleString("en-GB")} ·{" "}
                  {s.session_id.slice(0, 8)} ·{" "}
                  {s.status === "active" || s.status === "interrupted"
                    ? "Interrupted or unfinished"
                    : s.collection_status === "complete"
                      ? "Completed"
                      : "Incomplete collection"}
                </small>
              </div>
              <button
                className="secondary compact"
                disabled={working}
                onClick={() =>
                  void loadSnapshot(s.session_id)
                    .then((snapshot) => exportSession(snapshot))
                    .catch((e) => setError(errorText(e)))
                }
              >
                Download ZIP again
              </button>
              <button
                className="text-button"
                onClick={() =>
                  void loadSnapshot(s.session_id)
                    .then(setReview)
                    .catch((e) => setError(errorText(e)))
                }
              >
                Review recording
              </button>
            </div>
          ))}
          {review && phase !== "done" && (
            <SessionReview key={review.session.session_id} snapshot={review} />
          )}
        </details>
      )}
      <footer className="page-footer">
        <span>CompareThink research study</span>
        <span>Research data collection</span>
      </footer>
    </div>
  );
}
