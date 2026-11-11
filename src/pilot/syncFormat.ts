// Shared by the browser uploader and the server store.
// Audio chunks travel as one binary body: [u32 header length][header JSON][chunk bytes...].

import type { AudioChunk } from "./types";

/** AudioChunk without its Blob, plus the byte length carried in the frame. */
export type AudioChunkMeta = Omit<AudioChunk, "blob"> & {
  byte_length: number;
  sha256?: string;
};

export interface SyncStatus {
  exists: boolean;
  last_sequence: number | null;
  event_count: number;
  event_max_sequence: number | null;
  chunk_ids: string[];
  transcription_ids: string[];
}

export interface ServerSessionSummary {
  session_id: string;
  participant_id: string;
  ui_language?: string;
  task_title: string;
  task_language?: string;
  origin_utc: string;
  status: string;
  collection_status: string;
  synced_at?: string;
  event_count: number;
  audio_chunk_count: number;
  audio_bytes: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function frameHeader(metas: AudioChunkMeta[]): Uint8Array<ArrayBuffer> {
  const json = encoder.encode(JSON.stringify({ chunks: metas }));
  const out = new Uint8Array(4 + json.byteLength);
  new DataView(out.buffer).setUint32(0, json.byteLength);
  out.set(json, 4);
  return out;
}

export function encodeFrames(
  items: { meta: AudioChunkMeta; bytes: Uint8Array }[],
): Uint8Array {
  const header = frameHeader(
    items.map(({ meta, bytes }) => ({
      ...meta,
      byte_length: bytes.byteLength,
    })),
  );
  const total = items.reduce((n, item) => n + item.bytes.byteLength, 0);
  const out = new Uint8Array(header.byteLength + total);
  out.set(header, 0);
  let offset = header.byteLength;
  for (const { bytes } of items) {
    out.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return out;
}

export function decodeFrames(
  body: Uint8Array,
): { meta: AudioChunkMeta; bytes: Uint8Array }[] {
  if (body.byteLength < 4) throw new Error("Truncated audio frame");
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const headerLength = view.getUint32(0);
  if (4 + headerLength > body.byteLength)
    throw new Error("Truncated audio frame header");
  const parsed = JSON.parse(
    decoder.decode(body.subarray(4, 4 + headerLength)),
  ) as { chunks?: unknown };
  if (!Array.isArray(parsed.chunks))
    throw new Error("Audio frame header has no chunk list");
  let offset = 4 + headerLength;
  const items = parsed.chunks.map((meta: AudioChunkMeta) => {
    const length = meta?.byte_length;
    if (!Number.isInteger(length) || length < 0)
      throw new Error("Invalid audio chunk length");
    if (offset + length > body.byteLength)
      throw new Error("Truncated audio chunk bytes");
    const bytes = body.subarray(offset, offset + length);
    offset += length;
    return { meta, bytes };
  });
  if (offset !== body.byteLength)
    throw new Error("Unexpected bytes after the last audio chunk");
  return items;
}
