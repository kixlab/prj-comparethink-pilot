// Incremental SSE parser. Handles CRLF, UTF-8 splits and multiple data lines.
export async function* readSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, any>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  function parse(frame: string) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    return data && data !== "[DONE]" ? JSON.parse(data) : null;
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const event = parse(frame);
        if (event) yield event;
      }
      if (done) {
        if (buffer.trim()) {
          const event = parse(buffer);
          if (event) yield event;
        }
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
