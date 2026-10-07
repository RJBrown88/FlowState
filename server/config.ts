// The only file that reads process.env. Everything is checked once, at startup.

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  return n;
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY is not set (put it in .env.local)');
  process.exit(1);
}

export const config = {
  apiKey,
  isProd: process.env.NODE_ENV === 'production',
  port: int('PORT', 3000),
  host: process.env.HOST || '0.0.0.0',
  trustProxy: int('TRUST_PROXY', 0), // number of reverse proxies in front (0 = none)
  rateLimitPerMinute: int('RATE_LIMIT_PER_MINUTE', 10),
  modelId: 'gemini-3.1-pro-preview', // Phase 4 makes this configurable
} as const;
