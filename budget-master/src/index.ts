import 'dotenv/config';
import { startApi } from './api/index.js';

startApi().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
