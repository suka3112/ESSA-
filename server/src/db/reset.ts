/** Deletes the embedded data snapshot so the next server start reseeds the demo dataset. */
import fs from 'fs';
import path from 'path';

const file = path.resolve(__dirname, '../../data/db.json');
if (fs.existsSync(file)) {
  fs.unlinkSync(file);
  // eslint-disable-next-line no-console
  console.log('Demo data snapshot removed - restart the server to reseed.');
} else {
  // eslint-disable-next-line no-console
  console.log('No data snapshot found - nothing to reset.');
}
