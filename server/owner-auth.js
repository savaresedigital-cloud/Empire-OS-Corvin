import { createHmac, createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const same = (a, b) => a.length === b.length && timingSafeEqual(a, b);
export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 14 || password.length > 1024) throw Error('Scegli una password di almeno 14 caratteri.');
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return 'scrypt$' + salt + '$' + key.toString('hex');
}
export async function verifyPassword(password, hash) {
  if (typeof password !== 'string' || password.length > 1024 || !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(hash || '')) return false;
  const [, salt, expected] = hash.split('$');
  const actual = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return same(actual, Buffer.from(expected, 'hex'));
}
export function ownerSessions(env, now = () => Date.now()) {
  const secret = env.EMPIRE_SESSION_SECRET, hash = env.EMPIRE_OWNER_PASSWORD_HASH;
  if (typeof secret !== 'string' || secret.length < 43 || !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(hash || '')) throw Error('Configura l’accesso personale con npm run setup:owner.');
  const version = createHash('sha256').update(hash).digest('hex').slice(0, 16);
  const sign = value => createHmac('sha256', secret).update(value).digest('base64url');
  return {
    issue() { const value = Buffer.from(JSON.stringify({ exp: now() + 7 * 86400000, version, nonce: randomBytes(16).toString('hex') })).toString('base64url'); return value + '.' + sign(value); },
    verify(token) {
      if (typeof token !== 'string' || token.length > 2000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return false;
      const [value, signature] = token.split('.');
      if (!same(Buffer.from(signature), Buffer.from(sign(value)))) return false;
      try { const data = JSON.parse(Buffer.from(value, 'base64url')); return data.version === version && Number.isSafeInteger(data.exp) && data.exp > now() && data.exp <= now() + 7 * 86400000; } catch { return false; }
    },
  };
}
