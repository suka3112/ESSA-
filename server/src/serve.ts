/**
 * HOSTED ENTRYPOINT (Render / Railway / Azure App Service) — single web service.
 *
 * Boots the API exactly like `index.ts` (store init + demo seed + createApp),
 * then additionally serves the built web portal from `web/dist` with an SPA
 * fallback, so the whole platform runs as ONE process on ONE port.
 *
 * This lives in its own file on purpose: `app.ts` / `index.ts` are regenerated
 * by tooling from time to time, and hosting must not break when they are.
 * Do not add hosting logic to those files — keep it here.
 *
 * Start with:   node dist/serve.js      (server workspace)
 *               npm run start:hosted    (repo root)
 * Local development is unchanged (`npm run dev` → index.ts + Vite on :5173).
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createApp } from './app';
import { getDb, initStore, resetStore } from './core/store';
import { buildBaseDb, runScenarioSeed, SEED_VERSION } from './db/seed';
import { techLog } from './core/logger';

const PORT = Number(process.env.PORT ?? 4400);

// ---- bootstrap (mirrors index.ts) -------------------------------------------
let { seeded } = initStore(buildBaseDb);
if (!seeded && getDb()._seedVersion !== SEED_VERSION) {
  resetStore(buildBaseDb);
  seeded = true;
}
if (seeded) {
  runScenarioSeed();
}

const app = createApp();

// ---- hosted web portal --------------------------------------------------------
// Candidate locations for the Vite build output, first match wins.
const candidates = [
  process.env.WEB_DIST,
  path.resolve(__dirname, '../../web/dist'), // server/dist/serve.js  → web/dist
  path.resolve(process.cwd(), 'web/dist'), // started from repo root
  path.resolve(process.cwd(), '../web/dist'), // started from server/
].filter((p): p is string => Boolean(p));
const webDist = candidates.find((p) => fs.existsSync(path.join(p, 'index.html')));

if (webDist) {
  const indexHtml = path.join(webDist, 'index.html');
  // Hashed assets can be cached; index.html must not be (new deploys).
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  // SPA fallback for every non-API GET so deep links and refresh work.
  // Registered after createApp(): Express only reaches it when no API route
  // matched, so /api/* behaviour (including its 404s) is unchanged.
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(indexHtml);
  });
  techLog({ module: 'bootstrap', event: 'WEB_PORTAL_MOUNTED', message: `Serving web portal from ${webDist}` });
} else {
  techLog({
    module: 'bootstrap',
    event: 'WEB_PORTAL_MISSING',
    message: 'web/dist not found - run "npm run build" first. API only.',
  });
}

app.listen(PORT, () => {
  techLog({
    module: 'bootstrap',
    event: 'SERVER_STARTED',
    message: `ESSA AP Automation (hosted) listening on :${PORT}${seeded ? ' (demo dataset seeded)' : ''}`,
  });
});
