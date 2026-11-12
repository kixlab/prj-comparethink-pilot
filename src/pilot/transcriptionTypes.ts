export interface SttConfiguration {
  config_id: string;
  provider: "off" | "local-whisper" | "api";
  model: string;
  language: string;
  ready: boolean;
  remote_audio: boolean;
  api_origin?: string;
  api_base_url?: string;
  preprocessing?: {
    sample_rate_hz: 16000;
    channels: 1;
    pcm_bits: 16;
    api_part_ms?: number;
  };
  response_format?: "json" | "verbose_json" | "diarized_json";
}
export interface TranscriptCue {
  cue_id: string;
  text: string;
  audio_start_ms: number;
  audio_end_ms: number;
  start_t_ms: number;
  end_t_ms: number;
  speaker?: string;
}
export interface TranscriptionResult {
  status: "completed" | "partial";
  cues: TranscriptCue[];
  untimed_text: string;
  warnings: string[];
  duration_ms: number;
  detected_language?: string;
  model_sha256?: string;
  engine_version?: string;
  raw_result: unknown;
  error?: string;
}
export interface TranscriptionRecord {
  schema_version: "comparethink-transcription-v1";
  entry_id: string;
  attempt_id: string;
  session_id: string;
  segment_id: string;
  created_at_utc: string;
  status: "started" | "completed" | "partial" | "failed" | "interrupted";
  /** "server": transcribed automatically from the server copy. Absent: run in the browser. */
  generated_by?: "server";
  configuration: SttConfiguration;
  source: {
    started_t_ms: number;
    mime_type: string;
    bytes: number;
    sha256: string;
  };
  result?: TranscriptionResult;
  error?: string;
}

// Retries append a new attempt. Failed attempts never hide an earlier completed transcript.
export function displayTranscriptions(records: TranscriptionRecord[]) {
  const chosen = new Map<string, TranscriptionRecord>();
  for (const record of [...records].sort((a, b) =>
    a.created_at_utc.localeCompare(b.created_at_utc),
  )) {
    if (record.status !== "completed" && record.status !== "partial") continue;
    const prior = chosen.get(record.segment_id);
    if (record.status === "completed" || prior?.status !== "completed")
      chosen.set(record.segment_id, record);
  }
  return [...chosen.values()].sort(
    (a, b) => a.source.started_t_ms - b.source.started_t_ms,
  );
}
