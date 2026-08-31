import { createApp } from './app';
import { getDb, initStore, resetStore } from './core/store';
import { buildBaseDb, runScenarioSeed, SEED_VERSION } from './db/seed';
import { techLog } from './core/logger';
import { ensureEmailTemplates } from './modules/email/templates';

const PORT = Number(process.env.PORT ?? 4400);

let { seeded } = initStore(buildBaseDb);
if (!seeded && getDb()._seedVersion !== SEED_VERSION) {
  // Seed dataset evolved - refresh the local snapshot automatically.
  resetStore(buildBaseDb);
  seeded = true;
}
if (seeded) {
  runScenarioSeed();
}

// Email Template Configuration: make sure the collections and the system
// templates for every built-in scenario exist — including on local snapshots
// created before the feature shipped (no reseed required).
ensureEmailTemplates(getDb());

const app = createApp();
app.listen(PORT, () => {
  techLog({
    module: 'bootstrap',
    event: 'SERVER_STARTED',
    message: `ESSA AP Automation API listening on :${PORT}${seeded ? ' (demo dataset seeded)' : ''}`,
  });
});
