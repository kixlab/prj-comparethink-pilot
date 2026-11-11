import { useI18n } from "./i18n";
import { apiFetch } from "./access";
import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "./types";
import { errorText, id } from "./types";
import type {
  SttConfiguration,
  TranscriptionRecord,
  TranscriptionResult,
} from "./transcriptionTypes";
import { displayTranscriptions } from "./transcriptionTypes";
import {
  loadTranscriptions,
  retryTranscriptionWrites,
  saveTranscription,
  unsavedTranscriptionIds,
  transcriptionReadError,
} from "./storage";

const time = (ms: number) => {
  const ticks = Math.floor(Math.max(0, ms) / 100);
  return `${String(Math.floor(ticks / 600)).padStart(2, "0")}:${((ticks % 600) / 10).toFixed(1).padStart(4, "0")}`;
};
function validResult(value: any): value is TranscriptionResult {
  return (
    value &&
    ["completed", "partial"].includes(value.status) &&
    Array.isArray(value.cues) &&
    typeof value.untimed_text === "string" &&
    Array.isArray(value.warnings) &&
    value.cues.every(
      (cue: any) =>
        typeof cue.cue_id === "string" &&
        typeof cue.text === "string" &&
        [
          cue.audio_start_ms,
          cue.audio_end_ms,
          cue.start_t_ms,
          cue.end_t_ms,
        ].every(Number.isFinite) &&
        cue.audio_start_ms >= 0 &&
        cue.audio_end_ms >= cue.audio_start_ms &&
        cue.end_t_ms >= cue.start_t_ms,
    )
  );
}

export default function TranscriptionPanel({
  snapshot,
  playhead,
  onSeek,
}: {
  snapshot: Snapshot;
  playhead: number;
  onSeek: (t: number) => void;
}) {
  const { t } = useI18n();
  const sessionId = snapshot.session.session_id;
  const [configuration, setConfiguration] = useState<SttConfiguration | null>(
    null,
  );
  const [entries, setEntries] = useState<TranscriptionRecord[]>(
    snapshot.transcriptions ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const listEl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    void apiFetch("/api/stt/config", { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Could not load transcription configuration");
        setConfiguration(await response.json());
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(errorText(e));
      });
    void loadTranscriptions(sessionId)
      .then((records) => {
        setEntries(records);
        const readError = transcriptionReadError(sessionId);
        if (readError) setStorageError(readError);
      })
      .catch((e) => setStorageError(errorText(e)));
    return () => {
      abort.abort();
      controller.current?.abort();
    };
  }, [sessionId]);
  const visible = displayTranscriptions(entries);
  const cues = visible.flatMap((record) =>
    (record.result?.cues ?? []).map((cue) => ({ cue, record })),
  );
  const activeCueId = cues.find(
    ({ cue }) => playhead >= cue.start_t_ms && playhead <= cue.end_t_ms,
  )?.cue.cue_id;
  useEffect(() => {
    if (!activeCueId || !listEl.current) return;
    const frame = listEl.current;
    const active = frame.querySelector<HTMLElement>(".transcript-cue.active");
    if (!active) return;
    const bounds = active.getBoundingClientRect(),
      viewport = frame.getBoundingClientRect();
    if (bounds.top < viewport.top || bounds.bottom > viewport.bottom)
      frame.scrollTo({ top: frame.scrollTop + bounds.top - viewport.top - 8 });
  }, [activeCueId]);
  const attempts = new Map<string, TranscriptionRecord>();
  for (const entry of entries)
    if (entry.status !== "started" || !attempts.has(entry.attempt_id))
      attempts.set(entry.attempt_id, entry);
  const unfinished =
    !busy && [...attempts.values()].some((entry) => entry.status === "started");
  const recordings = snapshot.session.audio_segments.filter((segment) =>
    snapshot.audio.some(
      (chunk) => chunk.segment_id === segment.segment_id && chunk.size > 0,
    ),
  );
  const allCurrent =
    configuration &&
    recordings.length > 0 &&
    recordings.every((segment) =>
      entries.some(
        (entry) =>
          entry.segment_id === segment.segment_id &&
          entry.status === "completed" &&
          entry.configuration.config_id === configuration.config_id,
      ),
    );

  async function retain(entry: TranscriptionRecord) {
    setEntries((current) => [
      ...current.filter((r) => r.entry_id !== entry.entry_id),
      entry,
    ]);
    try {
      await saveTranscription(entry);
      return true;
    } catch (e) {
      setStorageError(errorText(e));
      return false;
    }
  }
  async function generate() {
    if (!configuration?.ready || busy) return;
    setBusy(true);
    setError("");
    setStorageError("");
    const abort = new AbortController();
    controller.current = abort;
    const targets = allCurrent
      ? recordings
      : recordings.filter(
          (segment) =>
            !entries.some(
              (r) =>
                r.segment_id === segment.segment_id &&
                r.status === "completed" &&
                r.configuration.config_id === configuration.config_id,
            ),
        );
    try {
      for (let index = 0; index < targets.length; index++) {
        if (abort.signal.aborted) break;
        const segment = targets[index];
        setProgress(
          t("Transcribing recording {number} of {total}…", {
            number: index + 1,
            total: targets.length,
          }),
        );
        const chunks = snapshot.audio
          .filter((chunk) => chunk.segment_id === segment.segment_id)
          .sort((a, b) => a.index - b.index);
        const blob = new Blob(
          chunks.map((chunk) => chunk.blob),
          { type: segment.mime_type },
        );
        const sha256 = [
          ...new Uint8Array(
            await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
          ),
        ]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        const started: TranscriptionRecord = {
          schema_version: "comparethink-transcription-v1",
          entry_id: id(),
          attempt_id: id(),
          session_id: sessionId,
          segment_id: segment.segment_id,
          created_at_utc: new Date().toISOString(),
          status: "started",
          configuration: structuredClone(configuration),
          source: {
            started_t_ms: segment.started_t_ms,
            mime_type: segment.mime_type,
            bytes: blob.size,
            sha256,
          },
        };
        try {
          if (!(await retain(started)))
            throw new Error(
              "Local transcript storage failed before the transcription request",
            );
          if (abort.signal.aborted) throw new Error("Transcription cancelled");
          const query = new URLSearchParams({
            session_id: sessionId,
            segment_id: segment.segment_id,
            started_t_ms: String(segment.started_t_ms),
            sha256,
            config_id: configuration.config_id,
          });
          const response = await apiFetch(`/api/stt/transcribe?${query}`, {
            method: "POST",
            headers: {
              "Content-Type": segment.mime_type || "application/octet-stream",
            },
            body: blob,
            signal: abort.signal,
          });
          const body = await response.json();
          if (!response.ok)
            throw new Error(
              body.error || `Transcription failed (HTTP ${response.status})`,
            );
          if (
            body.configuration?.config_id !== configuration.config_id ||
            body.sha256 !== sha256 ||
            !validResult(body.result)
          )
            throw new Error(
              "The transcription response does not match this recording or its settings",
            );
          const completed: TranscriptionRecord = {
            ...started,
            entry_id: id(),
            created_at_utc: new Date().toISOString(),
            status: body.result.status,
            result: body.result,
          };
          if (!(await retain(completed))) {
            setError(
              "The transcript remains in this tab. Retry saving before closing it.",
            );
            break;
          }
          if (completed.status === "partial") {
            setError(
              "Transcription stopped after a partial result. Earlier text is retained.",
            );
            break;
          }
        } catch (e) {
          const message = abort.signal.aborted
            ? "Transcription cancelled. Existing recordings and earlier results are retained."
            : errorText(e);
          await retain({
            ...started,
            entry_id: id(),
            created_at_utc: new Date().toISOString(),
            status: abort.signal.aborted ? "interrupted" : "failed",
            error: message,
          });
          setError(message);
          break;
        }
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      setProgress("");
      controller.current = null;
    }
  }

  return (
    <section
      className="transcription-panel"
      aria-label={t("Think-aloud transcript")}
    >
      <div className="transcription-heading">
        <h3>{t("Think-aloud transcript")}</h3>
        {busy ? (
          <button
            className="secondary compact"
            onClick={() => controller.current?.abort()}
          >
            {t("Cancel transcription")}
          </button>
        ) : (
          <button
            className="secondary compact"
            disabled={!configuration?.ready || !recordings.length}
            onClick={() => void generate()}
          >
            {allCurrent
              ? t("Transcribe again")
              : visible.length
                ? t("Transcribe remaining recordings")
                : t("Generate transcript")}
          </button>
        )}
      </div>
      {configuration && configuration.provider !== "off" && (
        <p className="transcription-provider">
          {configuration.provider === "local-whisper"
            ? t("Local Whisper")
            : "STT API"}{" "}
          · {configuration.model}
          {t(" · Language:")}{" "}
          {configuration.language === "auto"
            ? t("auto-detect")
            : configuration.language}
        </p>
      )}
      {!configuration?.ready && (
        <p className="transcription-help">
          {t(
            "Transcription is not configured on the server. The original recording is available above.",
          )}
        </p>
      )}
      {configuration?.ready && (
        <p className="transcription-help">
          {configuration.remote_audio
            ? t(
                "Generate sends recording audio to the transcription service ({origin}).",
                { origin: configuration.api_origin ?? "" },
              )
            : t(
                "Generate transcribes the recording on the app server without an external STT API.",
              )}{" "}
          {t(
            "Audio and transcripts are never included in the chat AI request.",
          )}
        </p>
      )}
      {busy && (
        <p className="transcription-progress" role="status">
          {progress}
        </p>
      )}
      {error && (
        <p className="transcription-error" role="alert">
          {t(error)}
        </p>
      )}
      {unfinished && (
        <p className="transcription-error">
          {t(
            "A previous attempt ended without a result. Generate again to retry.",
          )}
        </p>
      )}
      {(storageError || unsavedTranscriptionIds(sessionId).length > 0) && (
        <div className="transcription-error" role="alert">
          {t(
            "Some transcript entries could not be saved or loaded. Keep this tab open; the session ZIP includes the transcript entries currently available here.",
          )}
          <button
            onClick={() =>
              void retryTranscriptionWrites(sessionId)
                .then(() => loadTranscriptions(sessionId))
                .then((records) => {
                  setEntries(records);
                  setStorageError(transcriptionReadError(sessionId) ?? "");
                })
                .catch((e) => setStorageError(errorText(e)))
            }
          >
            {t("Retry saving transcript")}
          </button>
        </div>
      )}
      {!visible.length && !busy && (
        <p className="transcription-empty">
          {t("No transcript yet. Generate one from the saved recording.")}
        </p>
      )}
      {visible.length > 0 && (
        <>
          <p className="transcription-help">
            {t(
              "Machine-generated text · Estimated timings · Verify against the recording. Click a time to listen.",
            )}
          </p>
          <div className="transcript-cues" ref={listEl}>
            {visible.map((record) => (
              <div key={record.entry_id} className="transcript-recording">
                <div className="transcript-recording-meta">
                  {t("Recording ")}
                  {snapshot.session.audio_segments.findIndex(
                    (s) => s.segment_id === record.segment_id,
                  ) + 1}{" "}
                  ·{" "}
                  {record.configuration.provider === "local-whisper"
                    ? t("Local Whisper")
                    : "STT API"}{" "}
                  · {record.configuration.model}
                  {record.status === "partial" ? t(" · Partial") : ""}
                </div>
                {record.result?.cues.map((cue) => (
                  <div
                    className={`transcript-cue ${activeCueId === cue.cue_id ? "active" : ""}`}
                    key={cue.cue_id}
                  >
                    <button
                      className="text-button"
                      aria-label={t("Play transcript at {time}", {
                        time: time(cue.start_t_ms),
                      })}
                      onClick={() => onSeek(cue.start_t_ms)}
                    >
                      {time(cue.start_t_ms)}
                      <small>– {time(cue.end_t_ms)}</small>
                    </button>
                    <p>{cue.text}</p>
                  </div>
                ))}
                {record.result?.untimed_text && (
                  <div className="transcript-untimed">
                    <small>
                      {t("No speech timestamps were returned for this text.")}
                    </small>
                    <p>{record.result.untimed_text}</p>
                  </div>
                )}
                {!record.result?.cues.length &&
                  !record.result?.untimed_text && (
                    <p className="transcription-empty">
                      {t("No speech was recognized in this recording.")}
                    </p>
                  )}
                {record.result?.warnings.map((warning, index) => (
                  <p className="transcription-help" key={index}>
                    {warning}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
      {attempts.size > 0 && (
        <details className="transcription-history">
          <summary>
            {t("Transcription history (")}
            {attempts.size})
          </summary>
          <ul>
            {[...attempts.values()].map((entry) => (
              <li key={entry.attempt_id}>
                <strong>
                  {entry.status === "started" && !busy
                    ? t("Unfinished")
                    : t(entry.status)}
                </strong>{" "}
                · {entry.configuration.provider} · {entry.configuration.model}
                <small>
                  {entry.created_at_utc}
                  {entry.error ? ` · ${entry.error}` : ""}
                </small>
              </li>
            ))}
          </ul>
          <p>
            {t(
              "Every attempt is retained in the session ZIP. Retries do not replace earlier results.",
            )}
          </p>
        </details>
      )}
    </section>
  );
}
