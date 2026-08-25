import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { authMiddleware, correlationMiddleware, errorMiddleware } from './core/http';
import { authRouter } from './routes/auth';
import { invoiceRouter } from './routes/invoices';
import { exceptionRouter } from './routes/exceptions';
import { approvalRouter } from './routes/approvals';
import { vendorRouter } from './routes/vendors';
import { integrationRouter } from './routes/integrations';
import { adminRouter } from './routes/admin';
import { miscRouter } from './routes/misc';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));
  app.use(correlationMiddleware);
  app.use(authMiddleware);

  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok', service: 'essa-ap-automation', version: '0.1.0', time: new Date().toISOString() });
  });

  const api = express.Router();
  api.use(authRouter);
  api.use(invoiceRouter);
  api.use(exceptionRouter);
  api.use(approvalRouter);
  api.use(vendorRouter);
  api.use(integrationRouter);
  api.use(adminRouter);
  api.use(miscRouter);
  app.use('/api/v1', api);

  // ---------------------------------------------------------------------------
  // Production / hosted mode: serve the built web portal (web/dist) from this
  // same process so the whole platform runs as ONE web service (Render, Railway,
  // Azure App Service, ...). In local development the Vite dev server on :5173
  // proxies /api to this API instead, and web/dist does not exist - so this
  // block is a no-op there.
  // ---------------------------------------------------------------------------
  const webDist = process.env.WEB_DIST ?? path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    // SPA fallback: every non-API route returns index.html and React Router
    // resolves the page client-side (deep links / refresh keep working).
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use(errorMiddleware);
  return app;
}
