import { createApp } from './app';
import { getDb, initStore, resetStore } from './core/store';
import { buildBaseDb, runScenarioSeed, SEED_VERSION } from './db/seed';
import { techLog } from './core/logger';

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

const app = createApp();
app.listen(PORT, () => {
  techLog({
    module: 'bootstrap',
    event: 'SERVER_STARTED',
    message: `ESSA AP Automation API listening on :${PORT}${seeded ? ' (demo dataset seeded)' : ''}`,
  });
});
