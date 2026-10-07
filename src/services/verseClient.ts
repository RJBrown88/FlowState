import type { VerseConfig } from '../../shared/verse.ts';

/**
 * Streams a verse from the FlowState server. Yields text chunks as they arrive.
 * Throws with the server's message on errors, and an AbortError if `signal` is aborted.
 */
export async function* streamVerse(config: VerseConfig, signal?: AbortSignal) {
  const res = await fetch('/api/verse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Server error (${res.status})`);
  }

  // NDJSON: network chunks don't line up with lines, so buffer until each newline.
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let finished = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.error) throw new Error(msg.error);
        if (msg.done) finished = true;
        if (msg.text) yield msg.text as string;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  if (!finished) throw new Error('Connection dropped before the verse finished.');
}
