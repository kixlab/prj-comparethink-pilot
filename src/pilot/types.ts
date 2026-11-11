import type { Task } from "../../tasks/types";
import type { TranscriptionRecord } from "./transcriptionTypes";
import { translate, type Language } from "./translations";
export type { Task, TaskOption, TaskCatalog } from "../../tasks/types";
export type MessageStatus =
  "sent" | "streaming" | "completed" | "interrupted" | "failed";
export interface Message {
  message_id: string;
  request_id: string;
  role: "user" | "assistant";
  content: string;
  created_t_ms: number;
  request_dispatched_t_ms?: number;
  headers_received_t_ms?: number;
  first_received_t_ms?: number;
  first_display_t_ms?: number;
  paint_observed_t_ms?: number;
  ended_t_ms?: number;
  status: MessageStatus;
}
export interface RawEvent {
  event_id: string;
  session_id: string;
  sequence: number;
  t_ms: number;
  type: string;
  payload: Record<string, unknown>;
}
export interface Configuration {
  config_id: string;
  task: Task;
  model: string;
  provider: string;
  api_base_url?: string;
  project?: string;
  generation: {
    max_output_tokens: number;
    temperature?: number;
    reasoning?: { effort: string };
  };
  system_prompt: string;
  app_version: string;
  app_commit: string;
  api_ready: boolean;
}
export interface AudioSegment {
  segment_id: string;
  started_t_ms: number;
  start_call_t_ms: number;
  ended_t_ms?: number;
  mime_type: string;
  track_settings: MediaTrackSettings;
  stop_reason?: string;
}
export interface AudioChunk {
  chunk_id: string;
  session_id: string;
  segment_id: string;
  index: number;
  received_t_ms: number;
  recorder_timecode_ms: number | null;
  size: number;
  mime_type: string;
  blob: Blob;
}
export interface Gap {
  kind: string;
  start_t_ms: number;
  end_t_ms?: number;
  reason: string;
}
export interface Session {
  schema_version: "comparethink-session-v1";
  session_id: string;
  participant_id: string;
  ui_language?: Language;
  config: Configuration;
  instructions: { task: string; think_aloud: string; audio_notice: string };
  collection_policy?: {
    version: "submitted-chat-v1";
    draft_capture: false;
    audio: "continuous";
    timing: "client-observed";
  };
  clock: {
    origin_utc: string;
    performance_time_origin_ms: number;
    start_performance_ms: number;
    unit: "ms";
    method: string;
  };
  status: "active" | "completed" | "interrupted";
  collection_status: "collecting" | "complete" | "incomplete";
  issues: string[];
  gaps: Gap[];
  audio_segments: AudioSegment[];
  task_started_t_ms?: number;
  task_ended_t_ms?: number;
  ended_t_ms?: number;
  final_answer?: string;
  final_submitted_t_ms?: number;
  last_sequence: number;
  last_t_ms: number;
  environment: {
    user_agent: string;
    language: string;
    audio_constraints: MediaStreamConstraints;
  };
}
export interface Snapshot {
  session: Session;
  events: RawEvent[];
  audio: AudioChunk[];
  transcriptions?: TranscriptionRecord[];
  unsaved_transcription_ids?: string[];
  transcription_read_error?: string;
}
export const instructions = {
  task: "Read the action rules, initial state, and goal. You may chat with the AI freely while working on the action sequence. Submit your final plan yourself when you are finished.",
  think_aloud:
    "While working on the task, say what you are thinking as naturally as possible. Keep speaking while typing, waiting for the AI, and reading its responses. There is no required number of messages or speaking order.",
  audio_notice:
    "Microphone audio, sent chat messages, AI responses, and your submitted final plan are collected from task start until the session ends. Unsent text and edit history are not collected. Research audio and transcripts are not sent to the chat AI. After the task, recordings can be transcribed using the configured local or external transcription service. The microphone test recording is not included in the session data.",
};
export function instructionsForTask(task: Task) {
  const language = task.language === "ko" ? "ko" : "en";
  return {
    ...instructions,
    task: task.participant_instruction ?? instructions.task,
    think_aloud: translate(language, instructions.think_aloud),
    audio_notice: translate(language, instructions.audio_notice),
  };
}
export const audioConstraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
  video: false,
} satisfies MediaStreamConstraints;
export const id = () => crypto.randomUUID();
export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

export function requestMicrophone(timeoutMs = 30000): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(
        new Error(
          "Microphone access did not complete within 30 seconds. Check the browser permission and microphone connection, then try again.",
        ),
      );
    }, timeoutMs);
    navigator.mediaDevices.getUserMedia(audioConstraints).then(
      (stream) => {
        clearTimeout(timer);
        if (expired) stream.getTracks().forEach((t) => t.stop());
        else resolve(stream);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
