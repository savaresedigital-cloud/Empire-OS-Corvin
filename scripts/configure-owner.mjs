import { writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { passwordHash } from '../server/owner-auth.js';

async function hidden(prompt) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw Error('Apri questo comando in un terminale interattivo.');
  process.stdout.write(prompt); process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    function done(error) { process.stdin.off('data', receive); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); error ? reject(error) : resolve(value); }
    function receive(bytes) { for (const character of bytes.toString('utf8')) { if (character === '\r' || character === '\n') return done(); if (character === '\u0003') return done(Error('Configurazione annullata.')); if (character === '\u007f' || character === '\b') value = value.slice(0, -1); else if (value.length < 1024) value += character; } }
    process.stdin.on('data', receive);
  });
}
try {
  const first = await hidden('Scegli una password personale (almeno 14 caratteri, testo nascosto): ');
  const second = await hidden('Ripeti la password: ');
  if (first !== second) throw Error('Le password non coincidono. Nessun file creato.');
  const hash = await passwordHash(first);
  const text = `EMPIRE_OWNER_PASSWORD_HASH=${hash}\nEMPIRE_SESSION_SECRET=${randomBytes(32).toString('base64url')}\n`;
  await writeFile('.env.hostinger.local', text, { flag: 'wx', mode: 0o600 });
  console.log('Creato .env.hostinger.local. Importalo solo nelle variabili del server Hostinger; è escluso da Git. La password originale non è salvata nel file.');
} catch (error) { console.error(error.code === 'EEXIST' ? 'Il file privato esiste già. Nessun valore sovrascritto.' : error.message); process.exitCode = 1; }
