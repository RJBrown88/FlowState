// POST /api/verse — validates the request, calls Gemini and streams the verse back as NDJSON:
// one {"text": …} line per chunk, then {"done": true}, or {"error": …} if Gemini fails mid-stream.

import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { ApiError, GoogleGenAI } from '@google/genai';
import { config } from './config.ts';
import { SYSTEM_INSTRUCTION, buildPrompt } from './prompt.ts';
import { DENSITIES, GRIDS, LIMITS, ORBITS } from '../shared/verse.ts';
import type { VerseConfig } from '../shared/verse.ts';

const ai = new GoogleGenAI({ apiKey: config.apiKey });

export const verseRouter = Router();

const limiter = rateLimit({
  windowMs: 60_000,
  limit: config.rateLimitPerMinute,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many verses in a minute. Wait a moment and try again.' },
});

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

/** Returns a clean VerseConfig, or a message explaining what's wrong with the request. */
export function parseVerseRequest(body: unknown): VerseConfig | string {
  if (typeof body !== 'object' || body === null) return 'Request body must be a JSON object.';
  const { seed, density, orbit, grid, tone } = body as Record<string, unknown>;

  if (typeof seed !== 'string' || !seed.trim()) return 'Seed is required.';
  if (seed.trim().length > LIMITS.seed) return `Seed must be at most ${LIMITS.seed} characters.`;
  if (!isOneOf(DENSITIES, density)) return `Density must be one of ${DENSITIES.join(', ')}.`;
  if (!isOneOf(ORBITS, orbit)) return `Orbit must be one of ${ORBITS.join(', ')}.`;
  if (!isOneOf(GRIDS, grid)) return `Grid must be one of ${GRIDS.join(', ')}.`;
  if (tone !== undefined && tone !== null && typeof tone !== 'string') return 'Tone must be text.';
  const cleanTone = typeof tone === 'string' ? tone.trim() : '';
  if (cleanTone.length > LIMITS.tone) return `Tone must be at most ${LIMITS.tone} characters.`;

  return { seed: seed.trim(), density, orbit, grid, tone: cleanTone || undefined };
}

/** Short, user-facing explanation of a failed Gemini call. The full error goes to the server log. */
function describeGeminiError(err: unknown): string {
  const status = err instanceof ApiError ? err.status : undefined;
  const detail = err instanceof Error ? err.message : '';
  // Google reports a bad API key as 400 INVALID_ARGUMENT, not 401/403.
  if (status === 401 || status === 403 || /API[_ ]key/i.test(detail)) {
    return 'Server API key is invalid or lacks access.';
  }
  if (status === 400) return 'Gemini rejected the request.';
  if (status === 404) return `Model ${config.modelId} is unavailable.`;
  if (status === 429) return 'Gemini quota exceeded. Try again shortly.';
  return 'Gemini is having trouble. Try again.';
}

verseRouter.post('/verse', limiter, async (req, res) => {
  const verse = parseVerseRequest(req.body);
  if (typeof verse === 'string') {
    res.status(400).json({ error: verse });
    return;
  }

  // Listen on res, not req: req emits 'close' as soon as the request body has been read.
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      controller.abort();
      console.info('client disconnected, generation cancelled');
    }
  });

  // Set but not yet sent: if Gemini fails before the first chunk, we can still reply with a status code.
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no'); // stop nginx-style proxies from buffering the stream

  try {
    const stream = await ai.models.generateContentStream({
      model: config.modelId,
      contents: [{ role: 'user', parts: [{ text: buildPrompt(verse) }] }],
      config: { systemInstruction: SYSTEM_INSTRUCTION, temperature: 0.9, abortSignal: controller.signal },
    });
    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) res.write(JSON.stringify({ text }) + '\n');
    }
    res.end(JSON.stringify({ done: true }) + '\n');
  } catch (err) {
    if (controller.signal.aborted) return; // the user pressed Stop or left
    console.error('Gemini request failed:', err);
    const error = describeGeminiError(err);
    if (!res.headersSent) {
      res.status(502).json({ error });
      return;
    }
    res.end(JSON.stringify({ error }) + '\n');
  }
});
