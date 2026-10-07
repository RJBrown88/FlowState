// FlowState server: the /api routes plus the web app (Vite middleware in dev, built files in production).

import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import path from 'node:path';
import { config } from './config.ts';
import { verseRouter } from './verse.ts';

const app = express();
if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.use('/api', express.json({ limit: '4kb' }), verseRouter);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

if (config.isProd) {
  const dist = path.join(import.meta.dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'));
  });
} else {
  const { createServer } = await import('vite'); // dynamic: vite is a devDependency
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

// Last: any unhandled error, including malformed or oversized JSON bodies, becomes a JSON reply.
app.use((err: { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error(err);
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(status).json({ error: status < 500 ? 'Bad request.' : 'Internal server error.' });
});

app.listen(config.port, config.host, () => {
  console.log(`FlowState on http://${config.host}:${config.port}`);
});
