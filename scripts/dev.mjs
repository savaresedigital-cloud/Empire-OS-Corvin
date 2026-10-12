import { spawn } from 'node:child_process';
const children = [
  spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.js'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0'], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill(); setTimeout(() => process.exit(code), 100); }
for (const child of children) { child.on('error', error => { console.error(error.message); stop(1); }); child.on('exit', code => { if (!stopping) stop(code ?? 1); }); }
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
