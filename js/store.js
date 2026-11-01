// App state: unlock, local cache (works with no signal), and sync to GitHub.
import { deriveKey, openVault, sealVault, encryptText, decryptText } from './crypto.js';
import { merge, emptyData, sameData } from './model.js';
import { fetchVault, pushVault } from './github.js';

const LS = { cache: 'hp.cache', token: 'hp.token', name: 'hp.name', view: 'hp.view' };
const listeners = new Set();
export const state = { key: null, kdf: null, data: emptyData(), sha: null, pending: false, token: null, status: 'locked', lastSync: null, error: null };

export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { for (const fn of listeners) try { fn(what); } catch (e) { console.error(e); } }
function setStatus(status, error = null) { state.status = status; state.error = error; emit('status'); }

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
export const prefs = {
  get name() { return lsGet(LS.name) || ''; }, set name(v) { lsSet(LS.name, v); },
  get view() { try { return JSON.parse(lsGet(LS.view) || '{}'); } catch { return {}; } }, set view(v) { lsSet(LS.view, JSON.stringify(v)); },
};

// ---- remembered key (IndexedDB holds a non-extractable CryptoKey) ----
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('hunt-plan', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction('kv', mode); const req = fn(tx.objectStore('kv')); tx.oncomplete = () => res(req && req.result); tx.onerror = () => rej(tx.error); });
}
const rememberKey = (key, kdf) => idbDo('readwrite', (s) => s.put({ key, kdf }, 'key')).catch(() => {});
const forgetKey = () => idbDo('readwrite', (s) => s.delete('key')).catch(() => {});
const recallKey = () => idbDo('readonly', (s) => s.get('key')).catch(() => null);

// ---- local cache ----
async function writeCache() {
  const vault = await sealVault(state.key, state.kdf, state.data);
  lsSet(LS.cache, JSON.stringify({ vault, sha: state.sha, pending: state.pending }));
}
function readCache() { try { return JSON.parse(lsGet(LS.cache) || 'null'); } catch { return null; } }

async function loadToken() {
  const t = lsGet(LS.token);
  state.token = null;
  if (t) try { state.token = await decryptText(state.key, JSON.parse(t)); } catch {}
}
export async function setToken(token) {
  state.token = token || null;
  lsSet(LS.token, token ? JSON.stringify(await encryptText(state.key, token)) : null);
  emit('status');
}
export const canEdit = () => !!state.token;

// ---- unlock ----
async function tryOpen(key, vaultText) { try { return await openVault(key, vaultText); } catch { return null; } }

export async function autoUnlock() {
  const rec = await recallKey();
  const cache = readCache();
  if (!rec || !cache) return false;
  const data = await tryOpen(rec.key, cache.vault);
  if (!data) return false;
  Object.assign(state, { key: rec.key, kdf: rec.kdf, data, sha: cache.sha, pending: !!cache.pending });
  await loadToken();
  setStatus('ready'); emit('data');
  sync();
  return true;
}

export async function unlock(password, remember) {
  setStatus('unlocking');
  const cache = readCache();
  let remote = null;
  try { remote = await fetchVault(null); } catch (e) { if (!cache) { setStatus('locked', 'No connection and nothing saved on this device yet.'); return false; } }
  // Prefer the GitHub copy (newest password); fall back to this device's copy when offline.
  const candidates = [];
  if (remote && remote.text) candidates.push({ text: remote.text, sha: remote.sha, fromRemote: true });
  if (cache) candidates.push({ text: cache.vault, sha: cache.sha, fromRemote: false });
  if (!candidates.length) { setStatus('locked', 'No data file found in the repo yet.'); return false; }
  for (const c of candidates) {
    const v = JSON.parse(c.text);
    const key = await deriveKey(password, v.kdf.salt, v.kdf.iterations);
    let data = await tryOpen(key, c.text);
    if (!data) continue;
    let pending = false;
    if (c.fromRemote && cache) {
      const local = await tryOpen(key, cache.vault);
      if (local && cache.pending) { data = merge(data, local); pending = true; }
    }
    Object.assign(state, { key, kdf: v.kdf, data, sha: c.fromRemote ? c.sha : cache.sha, pending: pending || (!c.fromRemote && !!cache.pending) });
    await loadToken();
    if (remember) await rememberKey(key, v.kdf); else await forgetKey();
    await writeCache();
    setStatus('ready'); emit('data');
    if (state.pending) sync();
    return true;
  }
  setStatus('locked', 'Wrong password.');
  return false;
}

export async function lock() {
  await forgetKey();
  Object.assign(state, { key: null, kdf: null, data: emptyData(), token: null });
  setStatus('locked');
}

// ---- editing ----
let syncTimer = null;
export async function change(mutator, summary = 'Update') {
  if (!canEdit()) throw new Error('read-only');
  mutator(state.data);
  state.pending = true;
  state.lastSummary = summary;
  await writeCache();
  emit('data'); emit('status');
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, 2500);
}

export function upsert(collection, record, summary) {
  return change((d) => {
    d[collection] = d[collection] || [];
    const r = { ...record, updated: Date.now() };
    const i = d[collection].findIndex((x) => x.id === r.id);
    if (i >= 0) d[collection][i] = r; else d[collection].push(r);
    if (d.deleted && d.deleted[r.id]) delete d.deleted[r.id];
  }, summary);
}
export function remove(collection, id, summary) {
  return change((d) => {
    d[collection] = (d[collection] || []).filter((x) => x.id !== id);
    d.deleted = d.deleted || {}; d.deleted[id] = Date.now();
  }, summary);
}

// ---- sync ----
let syncing = null;
export function sync() { if (!syncing) syncing = doSync().finally(() => { syncing = null; }); return syncing; }

async function doSync() {
  if (!state.key) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { setStatus('offline'); return; }
  setStatus('syncing');
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await fetchVault(state.token);
      let remoteData = null;
      if (remote.text) {
        const v = JSON.parse(remote.text);
        if (v.kdf.salt !== state.kdf.salt) { await lock(); setStatus('locked', 'The password was changed. Enter the new one.'); return; }
        remoteData = await openVault(state.key, remote.text);
      }
      const merged = remoteData ? merge(remoteData, state.data) : state.data;
      const changedLocally = !sameData(state.data, merged);
      state.data = merged;
      if (!state.pending || !state.token) {
        state.sha = remote.sha || state.sha;
        await writeCache();
        if (changedLocally) emit('data');
        break;
      }
      if (remote.source === 'pages') throw new Error('Could not reach GitHub to save.');
      try {
        const msg = `${state.lastSummary || 'Update'}${prefs.name ? ' (' + prefs.name + ')' : ''}`;
        state.sha = await pushVault(state.token, await sealVault(state.key, state.kdf, merged), remote.sha, msg);
        state.pending = false;
        await writeCache();
        if (changedLocally) emit('data');
        break;
      } catch (e) {
        if (e.conflict && attempt < 2) continue;
        throw e;
      }
    }
    state.lastSync = new Date();
    setStatus('ready');
  } catch (e) {
    console.warn(e);
    setStatus('error', e.message);
  }
}

// Re-encrypt everything under a new password (editors only).
export async function changePassword(newPassword) {
  const { newKdf } = await import('./crypto.js');
  const kdf = newKdf();
  const key = await deriveKey(newPassword, kdf.salt, kdf.iterations);
  const remote = await fetchVault(state.token);
  if (remote.source === 'pages') throw new Error('Could not reach GitHub.');
  const data = remote.text ? merge(await openVault(state.key, remote.text), state.data) : state.data;
  const sha = await pushVault(state.token, await sealVault(key, kdf, data), remote.sha, 'Change password');
  const token = state.token;
  Object.assign(state, { key, kdf, data, sha, pending: false });
  await setToken(token);
  await rememberKey(key, kdf);
  await writeCache();
  emit('data'); setStatus('ready');
}

// Editor links carry the GitHub key encrypted with the site password, so a link alone is useless.
export async function makeEditorLink() {
  const sealed = await encryptText(state.key, state.token);
  const payload = btoa(JSON.stringify({ s: state.kdf.salt, ...sealed })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return location.origin + location.pathname + '#edit=' + payload;
}
export async function acceptEditorPayload(payload) {
  try {
    const j = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (j.s !== state.kdf.salt) return { ok: false, reason: 'This editor link was made before the password changed. Ask for a new one.' };
    await setToken(await decryptText(state.key, j));
    return { ok: true };
  } catch { return { ok: false, reason: 'That editor link did not work.' }; }
}
