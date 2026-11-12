import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  Configuration,
  Message,
  Session,
  Snapshot,
  TaskCatalog,
} from "./types";
import { errorText, id, instructionsForTask, requestMicrophone } from "./types";
import TravelTaskPanel from "./TravelTaskPanel";
import { SessionEngine } from "./engine";
import SessionReview from "./SessionReview";
import { useI18n } from "./i18n";
import { ACCESS_LINK_ERROR, apiFetch } from "./access";
import {
  listSessions,
  loadSnapshot,
  openDatabase,
  loadTranscriptions,
  unsavedTranscriptionIds,
  transcriptionReadError,
} from "./storage";
import { buildArchive, downloadArchive, messagesFromEvents } from "./export";
import {
  SyncManager,
  listServerSessions,
  loadServerSnapshot,
  type SyncState,
} from "./sync";
import type { ServerSessionSummary } from "./syncFormat";

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
  const { t } = useI18n();
  const task = config.task;
  if (task.kind === "travelplanner") return <TravelTaskPanel task={task} />;
  return (
    <aside className="task-panel">
      <h2>{task.title}</h2>
      <p>{task.description}</p>
      <h3>{t("Initial state")}</h3>
      <div className="blocks" aria-label={t("Initial block arrangement")}>
        {task.initial_stacks.map((stack, i) => (
          <div key={i}>
            {[...stack].reverse().map((color) => (
              <span key={color} className={`block ${color}`}>
                {t(blockLabels[color] ?? color)}
              </span>
            ))}
          </div>
        ))}
        <span className="table-label">{t("Table")}</span>
      </div>
      <ul className="state-list">
        {task.initial_state.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <div className="goal">
        <div className="eyebrow">{t("Goal state")}</div>
        {task.goal_state.map((s) => (
          <strong key={s}>{s}</strong>
        ))}
      </div>
      <h3>{t("Action rules")}</h3>
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
        <summary>{t("Task source and original wording")}</summary>
        <p>
          {t("PlanBench · task_1_plan_generation · instance")}{" "}
          {task.source.instance_id}
          {t(
            ". The rules and target problem are shown below. The separate example and reference solution are excluded.",
          )}
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
  const { t } = useI18n();
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
        <strong>{message.role === "user" ? t("You") : "AI"}</strong>
        <time>{seconds(message.created_t_ms)}</time>
        <span>{t(status)}</span>
      </div>
      <div className="message-text">
        {message.content ||
          (message.status === "streaming" ? (
            <span className="waiting">
              {t("Waiting for a response")}
              <span>…</span>
            </span>
          ) : (
            t("No text was received.")
          ))}
      </div>
    </article>
  );
}
function ServerBackup({ state }: { state?: SyncState }) {
  const { t } = useI18n();
  const status = state?.status ?? "syncing";
  const text =
    status === "synced"
      ? t("All data is saved on the server.")
      : status === "error"
        ? t("Server upload failed: {error}. Retrying automatically.", {
            error: state?.error ?? "",
          })
        : state?.pending
          ? t("Uploading to the server… {count} items remaining", {
              count: state.pending,
            })
          : t("Uploading to the server…");
  return (
    <div className={`server-backup ${status}`} role="status">
      <strong>{t("Server backup")}</strong>
      <span>{text}</span>
    </div>
  );
}
const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
export default function App() {
  const { language, setLanguage, t } = useI18n();
  const [admin, setAdmin] = useState(false);
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
  const [sync] = useState(() => new SyncManager(() => rerender((v) => v + 1)));
  const [serverSessions, setServerSessions] = useState<
    ServerSessionSummary[] | null
  >(null);
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
  const adminCandidate = participant.trim().toLowerCase() === "admin";
  function enterAdmin() {
    if (
      !adminCandidate ||
      phase !== "mic" ||
      working ||
      micState === "recording"
    )
      return;
    setError("");
    setReview(null);
    setMicState("idle");
    setMicConfirmed(false);
    setTestUrl("");
    setAdmin(true);
  }
  useEffect(() => {
    let cancelled = false;
    void apiFetch("/api/tasks")
      .then(async (r) => {
        if (r.status === 401) throw new Error(ACCESS_LINK_ERROR);
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
    void openDatabase().catch((e) =>
      setError(t("Storage error: {error}", { error: errorText(e) })),
    );
    return () => {
      cancelled = true;
      const recorder = testRecorder.current;
      if (recorder?.state === "recording") recorder.stop();
    };
  }, []);
  useEffect(() => {
    void sync.start();
    return () => sync.stop();
  }, [sync]);
  useEffect(() => {
    if (admin && sync.enabled) void refreshServerSessions();
  }, [admin, sync.enabled]);
  async function refreshServerSessions() {
    try {
      setServerSessions(await listServerSessions());
    } catch (e) {
      setServerSessions(null);
      setError(errorText(e));
    }
  }
  useEffect(() => {
    if (!admin) return;
    let cancelled = false;
    void listSessions()
      .then((sessions) => {
        if (!cancelled) setSaved(sessions);
      })
      .catch((e) => {
        if (!cancelled)
          setError(t("Storage error: {error}", { error: errorText(e) }));
      });
    return () => {
      cancelled = true;
    };
  }, [admin]);
  useEffect(() => {
    if (!selectedTaskId) return;
    const controller = new AbortController();
    setConfig(null);
    void apiFetch(
      `/api/config?task_id=${encodeURIComponent(selectedTaskId)}&language=${language}`,
      {
        signal: controller.signal,
      },
    )
      .then(async (r) => {
        if (r.status === 401) throw new Error(ACCESS_LINK_ERROR);
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
  }, [selectedTaskId, language]);
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
      setError(t("Microphone unavailable: {error}", { error: errorText(e) }));
      setMicState("idle");
    } finally {
      setWorking(false);
    }
  }
  async function begin() {
    if (!config || working) return;
    if (adminCandidate) {
      enterAdmin();
      return;
    }
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
      sync.current = current.session.session_id;
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
      void sync.sync(engine.session.session_id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      releaseLock.current();
      setWorking(false);
    }
  }
  async function exportSession(
    snapshot: Snapshot,
    current = false,
    fromServer = false,
  ) {
    setWorking(true);
    setError("");
    try {
      if (current && engine) {
        engine.log("export_requested");
        await engine.journal.flush();
      }
      const exported = { ...snapshot };
      if (!fromServer)
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
      if (!fromServer)
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
        t(
          "Could not prepare the download: {error}. You can retry from Saved sessions.",
          { error: errorText(e) },
        ),
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
        <span className="header-note">{t("Planning study")}</span>
        <label className="language-select">
          {t("Language")}
          <select
            aria-label={t("Language")}
            value={language}
            disabled={
              phase === "active" ||
              phase === "guide" ||
              working ||
              micState === "recording"
            }
            onChange={(event) => setLanguage(event.target.value as "en" | "ko")}
          >
            <option value="en">English</option>
            <option value="ko">한국어</option>
          </select>
        </label>
      </header>
      {!admin && (
        <nav className="progress" aria-label={t("Study progress")}>
          {steps.map((s, i) => (
            <div
              className={
                i === phaseNumber ? "current" : i < phaseNumber ? "past" : ""
              }
              aria-current={i === phaseNumber ? "step" : undefined}
              key={s}
            >
              <span>{i + 1}.</span>
              {t(s)}
            </div>
          ))}
        </nav>
      )}
      {error && (
        <div className="alert error" role="alert">
          {t(error)}
        </div>
      )}
      {!admin && phase === "mic" && (
        <main className="onboarding">
          <section className="setup-card">
            <h1>{t("Session setup")}</h1>
            <label>
              {t("Participant ID")}
              <input
                aria-label={t("Participant ID")}
                value={participant}
                onChange={(e) => setParticipant(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && adminCandidate) {
                    e.preventDefault();
                    enterAdmin();
                  }
                }}
                disabled={working || micState === "recording"}
                maxLength={64}
                autoComplete="off"
              />
              <small>{t("Do not enter your name or contact details.")}</small>
            </label>
            {adminCandidate ? (
              <button
                className="primary full"
                onClick={enterAdmin}
                disabled={working || micState === "recording"}
              >
                {t("Open admin")}
              </button>
            ) : (
              <>
                <label htmlFor="study-task">{t("Task")}</label>
                <select
                  id="study-task"
                  aria-label={t("Task")}
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
                    url.searchParams.set(
                      "task",
                      option?.kind ?? e.target.value,
                    );
                    history.replaceState(null, "", url);
                  }}
                >
                  {!catalog || !selectedTaskId ? (
                    <option value="">
                      {catalog ? t("Select a task") : t("Loading tasks…")}
                    </option>
                  ) : null}
                  {catalog?.tasks.map((task) => (
                    <option key={task.task_id} value={task.task_id}>
                      {t(task.title)}
                    </option>
                  ))}
                </select>
                <p className="task-summary">
                  {t(
                    catalog?.tasks.find(
                      (task) => task.task_id === selectedTaskId,
                    )?.summary ?? "",
                  )}
                </p>
                <h2>{t("Microphone check")}</h2>
                <p>
                  {t(
                    "Record a short sample, then play it back to check that your voice is audible.",
                  )}
                </p>
                <div
                  className={`mic-test ${micState === "recording" ? "live" : ""}`}
                >
                  <strong>
                    {micState === "recording"
                      ? t("Test recording in progress")
                      : micState === "ready"
                        ? t("Test recording ready")
                        : t("Microphone not tested")}
                  </strong>
                  <div className="level-track">
                    <i style={{ width: `${level}%` }} />
                  </div>
                  <small>
                    {micState === "recording"
                      ? t("Speak a sentence or two.")
                      : t(
                          "The test recording is not included in the study data.",
                        )}
                  </small>
                </div>
                {micState === "recording" ? (
                  <button
                    className="secondary full"
                    onClick={() => testRecorder.current?.stop()}
                  >
                    {t("Stop test recording")}
                  </button>
                ) : (
                  <button
                    className="secondary full"
                    disabled={working}
                    onClick={() => void testMic()}
                  >
                    {micState === "ready"
                      ? t("Test microphone again")
                      : t("Start microphone test")}
                  </button>
                )}
                {testUrl && (
                  <>
                    <audio
                      aria-label={t("Microphone test playback")}
                      src={testUrl}
                      controls
                    />
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={micConfirmed}
                        onChange={(e) => setMicConfirmed(e.target.checked)}
                      />
                      {t("I played the recording and could hear my voice.")}
                    </label>
                  </>
                )}
                <button
                  className="primary full"
                  disabled={
                    !micConfirmed ||
                    !config ||
                    working ||
                    micState === "recording"
                  }
                  onClick={() => {
                    setError("");
                    setPhase("guide");
                  }}
                >
                  {t("Continue to instructions")}
                </button>
              </>
            )}
          </section>
        </main>
      )}
      {phase === "guide" && config && (
        <main className="guide-grid">
          <TaskPanel config={config} />
          <section className="guide-main">
            <h1>{t("Instructions")}</h1>
            <div className="instruction-card">
              <div>
                <h3>{t("Task and chat")}</h3>
                <p>{instructionsForTask(config.task).task}</p>
              </div>
            </div>
            <div className="instruction-card">
              <div>
                <h3>{t("Think-aloud instructions")}</h3>
                <p>{instructionsForTask(config.task).think_aloud}</p>
              </div>
            </div>
            <div className="instruction-card">
              <div>
                <h3>{t("Submit your final plan")}</h3>
                <p>{config.task.final_instruction}</p>
              </div>
            </div>
            <div className="notice">
              {instructionsForTask(config.task).audio_notice}
            </div>
            {!config.api_ready && (
              <div className="alert">
                {t(
                  "The AI service is not configured. Please contact the researcher.",
                )}
              </div>
            )}
            <button
              className="primary"
              disabled={working || !config.api_ready}
              onClick={() => void begin()}
            >
              {working ? t("Preparing recording…") : t("Start task")}
            </button>
            <button
              className="text-button"
              disabled={working}
              onClick={() => setPhase("mic")}
            >
              {t("Check microphone again")}
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
                {engine.audioHealthy ? t("Recording") : t("Recording stopped")}
              </strong>
              <span className="elapsed">{seconds(elapsed)}</span>
            </div>
            <span>
              {t("Participant: ")}
              {engine.session.participant_id}
            </span>
            <span className="session-task">
              {t("Task: ")}
              {engine.session.config.task.title}
            </span>
            <span className="save-state">
              {engine.journal.blocked
                ? t("Storage error · retained in memory")
                : engine.journal.pending.length
                  ? t("Saving…")
                  : t("Saved locally")}
            </span>
          </div>
          {engine.journal.blocked && (
            <div className="alert error">
              {t(
                "New messages are disabled because local storage failed. Keep this tab open and retry saving or download the current record.",
              )}
              <button onClick={() => void engine.retryStorage()}>
                {t("Retry saving")}
              </button>
              <button onClick={() => void exportSession(engine.snapshot, true)}>
                {t("Download current record")}
              </button>
            </div>
          )}
          {!engine.audioHealthy && (
            <div className="alert error">
              {t(
                "Recording stopped. The missing interval will remain in the study record.",
              )}
              <button
                onClick={() =>
                  void engine
                    .restartRecording()
                    .catch((e) => setError(errorText(e)))
                }
              >
                {t("Reconnect microphone")}
              </button>
            </div>
          )}
          <main className="workspace">
            <TaskPanel config={engine.session.config} />
            <section className="chat-panel">
              <div className="chat-heading">
                <div>
                  <h2>{t("Chat")}</h2>
                </div>
                <span className="model-label">
                  {engine.session.config.model}
                </span>
              </div>
              <div
                className="chat-history"
                aria-label={t("Chat history")}
                aria-live="polite"
              >
                {messages.length === 0 && (
                  <div className="empty-chat">
                    <h3>{t("No messages yet.")}</h3>
                    <p>{t("You may chat with the AI freely.")}</p>
                  </div>
                )}
                {messages.map((m) => (
                  <ChatMessage key={m.message_id} message={m} engine={engine} />
                ))}
                <div ref={chatBottom} />
              </div>
              <div className="composer">
                <label htmlFor="chat-input" className="sr-only">
                  {t("Message to AI")}
                </label>
                <textarea
                  id="chat-input"
                  value={prompt}
                  placeholder={t("Type a message…")}
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
                  <small>
                    {t("Enter to send · Shift+Enter for a new line")}
                  </small>
                  {engine.busy ? (
                    <button
                      className="secondary compact"
                      onClick={() => engine.cancel()}
                    >
                      {t("Stop response")}
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
                      {t("Send")}
                    </button>
                  )}
                </div>
              </div>
              <div className="task-footer">
                <span>
                  {t("Submit your final plan separately from the chat.")}
                </span>
                <button
                  className="secondary"
                  onClick={() => setShowFinal(!showFinal)}
                  disabled={engine.ending}
                >
                  {showFinal ? t("Close final plan") : t("Write final plan")}
                </button>
              </div>
              {showFinal && (
                <section className="final-panel">
                  <h3>{t("Final plan")}</h3>
                  <p>{engine.session.config.task.final_instruction}</p>
                  <textarea
                    aria-label={t("Final plan")}
                    rows={6}
                    value={finalAnswer}
                    onChange={(e) => setFinalAnswer(e.currentTarget.value)}
                    placeholder={
                      engine.session.config.task.kind === "travelplanner"
                        ? t("Enter your day-by-day itinerary.")
                        : t("Enter the actions in order.")
                    }
                  />
                  <button
                    className="primary"
                    disabled={!finalAnswer.trim() || working}
                    onClick={() => void finish(finalAnswer)}
                  >
                    {t("Submit final plan and end session")}
                  </button>
                </section>
              )}
              <button
                className="text-button end-session"
                disabled={working}
                onClick={() => void finish()}
              >
                {t("End session without submitting")}
              </button>
            </section>
          </main>
        </>
      )}
      {phase === "done" && engine && (
        <main className="completion">
          <div className="completion-heading">
            <div>
              <h1>{t("Session ended")}</h1>
              <p>
                {engine.session.final_answer
                  ? t(
                      "Review your conversation and think-aloud recording below.",
                    )
                  : t("The session ended without a final plan submission.")}
              </p>
            </div>
            <div className="completion-actions">
              <button
                className="primary"
                disabled={working}
                onClick={() => void exportSession(engine.snapshot, true)}
              >
                {t("Download session ZIP")}
              </button>
              <button
                className="secondary"
                onClick={() => window.location.reload()}
                disabled={engine.journal.pending.length > 0}
              >
                {t("Prepare a new session")}
              </button>
            </div>
          </div>
          {engine.journal.blocked && (
            <div className="alert error" role="alert">
              {t(
                "Some data has not been saved and remains in this tab. Keep the tab open and retry saving or download the session ZIP.",
              )}
            </div>
          )}
          <div
            className={`collection-result ${engine.session.collection_status === "complete" ? "" : "incomplete"}`}
          >
            <strong>
              {engine.session.collection_status === "complete"
                ? t("Complete")
                : t("Incomplete collection · errors or gaps recorded")}
            </strong>
            <span>
              {t("Human prompts:")}{" "}
              {engine.messages.filter((m) => m.role === "user").length}
              {t(" · AI responses:")}{" "}
              {engine.messages.filter((m) => m.role === "assistant").length}
              {t(" · Recordings: ")}
              {engine.session.audio_segments.length}
            </span>
            {engine.session.issues.map((issue, i) => (
              <small key={i}>{issue}</small>
            ))}
          </div>
          {sync.enabled && (
            <ServerBackup state={sync.state(engine.session.session_id)} />
          )}
          {engine.journal.blocked && (
            <button
              className="secondary"
              onClick={() => void engine.retryStorage()}
            >
              {t("Retry saving")}
            </button>
          )}
          {review && (
            <SessionReview
              key={review.session.session_id}
              snapshot={review}
              serverTranscribes={sync.autoTranscribe}
            />
          )}
        </main>
      )}
      {admin && (
        <main className="admin-panel">
          <div className="completion-heading">
            <h1>{t("Admin")}</h1>
            <button
              className="secondary"
              onClick={() => {
                setAdmin(false);
                setSaved([]);
                setServerSessions(null);
                setReview(null);
                setError("");
                setParticipant(`p-${id().slice(0, 8)}`);
              }}
            >
              {t("Back to participant setup")}
            </button>
          </div>
          {sync.enabled && (
            <section
              className="saved-sessions server-sessions"
              aria-label={t("Server sessions")}
            >
              <div>
                <h2>{t("Server sessions")}</h2>
                <p>
                  {t(
                    "Sessions uploaded to the server from every participant's browser.",
                  )}
                </p>
                <button
                  className="secondary compact"
                  disabled={working}
                  onClick={() => void refreshServerSessions()}
                >
                  {t("Refresh")}
                </button>
              </div>
              {serverSessions && !serverSessions.length && (
                <p>{t("No sessions on the server yet.")}</p>
              )}
              {serverSessions?.map((s) => (
                <div className="saved-row" key={s.session_id}>
                  <div>
                    <strong>{s.participant_id}</strong>
                    <small>{t(s.task_title)}</small>
                    <small>
                      {s.ui_language === "ko" || s.task_language === "ko"
                        ? "한국어"
                        : "English"}
                    </small>
                    <small>
                      {new Date(s.origin_utc).toLocaleString(
                        language === "ko" ? "ko-KR" : "en-GB",
                      )}{" "}
                      · {s.session_id.slice(0, 8)} ·{" "}
                      {s.status === "active" || s.status === "interrupted"
                        ? t("Interrupted or unfinished")
                        : s.collection_status === "complete"
                          ? t("Completed")
                          : t("Incomplete collection")}
                    </small>
                    <small>
                      {t("{events} events · {chunks} audio chunks", {
                        events: s.event_count,
                        chunks: s.audio_chunk_count,
                      })}{" "}
                      · {megabytes(s.audio_bytes)}
                    </small>
                  </div>
                  <button
                    className="secondary compact"
                    disabled={working}
                    onClick={() => {
                      setWorking(true);
                      void loadServerSnapshot(s.session_id)
                        .then((snapshot) =>
                          exportSession(snapshot, false, true),
                        )
                        .catch((e) => {
                          setError(errorText(e));
                          setWorking(false);
                        });
                    }}
                  >
                    {t("Download ZIP")}
                  </button>
                  <button
                    className="text-button"
                    disabled={working}
                    onClick={() => {
                      setWorking(true);
                      void loadServerSnapshot(s.session_id)
                        .then(setReview)
                        .catch((e) => setError(errorText(e)))
                        .finally(() => setWorking(false));
                    }}
                  >
                    {t("Review recording")}
                  </button>
                </div>
              ))}
            </section>
          )}
          <section className="saved-sessions" aria-label={t("Saved sessions")}>
            <div>
              <h2>{t("Saved sessions")}</h2>
              <p>
                {t(
                  "You can download saved sessions again. Unfinished sessions are exported as incomplete.",
                )}
              </p>
            </div>
            {!saved.length && <p>{t("No saved sessions on this browser.")}</p>}
            {saved.map((s) => (
              <div className="saved-row" key={s.session_id}>
                <div>
                  <strong>{s.participant_id}</strong>
                  <small>{t(s.config.task.title)}</small>
                  <small>
                    {s.ui_language === "ko" || s.config.task.language === "ko"
                      ? "한국어"
                      : "English"}
                  </small>
                  <small>
                    {new Date(s.clock.origin_utc).toLocaleString(
                      language === "ko" ? "ko-KR" : "en-GB",
                    )}{" "}
                    · {s.session_id.slice(0, 8)} ·{" "}
                    {s.status === "active" || s.status === "interrupted"
                      ? t("Interrupted or unfinished")
                      : s.collection_status === "complete"
                        ? t("Completed")
                        : t("Incomplete collection")}
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
                  {t("Download ZIP again")}
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    void loadSnapshot(s.session_id)
                      .then(setReview)
                      .catch((e) => setError(errorText(e)))
                  }
                >
                  {t("Review recording")}
                </button>
              </div>
            ))}
            {review && (
              <SessionReview
                key={review.session.session_id}
                snapshot={review}
              />
            )}
          </section>
        </main>
      )}
      <footer className="page-footer">
        <span>{t("CompareThink research study")}</span>
        <span>{t("Research data collection")}</span>
      </footer>
    </div>
  );
}
