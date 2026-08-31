import express from 'express';
import cors from 'cors';
import { authMiddleware, correlationMiddleware, errorMiddleware } from './core/http';
import { authRouter } from './routes/auth';
import { invoiceRouter } from './routes/invoices';
import { exceptionRouter } from './routes/exceptions';
import { approvalRouter } from './routes/approvals';
import { vendorRouter } from './routes/vendors';
import { integrationRouter } from './routes/integrations';
import { adminRouter } from './routes/admin';
import { slaRouter } from './routes/sla';
import { miscRouter } from './routes/misc';
import { emailTemplateRouter } from './routes/email-templates';

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
  api.use(emailTemplateRouter);
  api.use(slaRouter);
  api.use(miscRouter);
  app.use('/api/v1', api);

  app.use(errorMiddleware);
  return app;
}
