import { startHosted } from './server/hosted.js';
startHosted().catch(error => { console.error(error.message); process.exitCode = 1; });
