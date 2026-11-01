// Vault encryption: PBKDF2-SHA256 -> AES-256-GCM. Works in browsers and Node 18+.
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
export const ITERATIONS = 310000;

export function b64(bytes) {
  let s = '';
  const a = new Uint8Array(bytes);
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(str) {
  const s = atob(str);
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}
export const b64url = (bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = (s) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));

export function randomBytes(n) { return globalThis.crypto.getRandomValues(new Uint8Array(n)); }

export async function deriveKey(password, saltB64, iterations = ITERATIONS) {
  const base = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptText(key, text) {
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return { iv: b64(iv), ct: b64(ct) };
}
export async function decryptText(key, { iv, ct }) {
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct));
  return dec.decode(pt);
}

// A vault file is JSON: { v, kdf:{iterations,salt}, iv, ct, savedAt }
export async function sealVault(key, kdf, data) {
  const { iv, ct } = await encryptText(key, JSON.stringify(data));
  return JSON.stringify({ v: 1, kdf, iv, ct, savedAt: new Date().toISOString() }, null, 1) + '\n';
}
export async function openVault(key, vaultText) {
  const v = typeof vaultText === 'string' ? JSON.parse(vaultText) : vaultText;
  return JSON.parse(await decryptText(key, v));
}
export function newKdf() { return { name: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: b64(randomBytes(16)) }; }
