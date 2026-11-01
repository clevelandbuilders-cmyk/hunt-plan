// Data model + merge. Every top-level array of {id, updated} records merges the same way,
// so later steps can add collections (e.g. "sightings", "camPhotos", "hunts") without touching sync.
export const SCHEMA = 1;

export function emptyData() {
  return { schema: SCHEMA, properties: [], features: [], deleted: {}, meta: {} };
}

export function uid(prefix = 'f') {
  const r = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return prefix + '_' + Date.now().toString(36) + Array.from(r, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
}

export function collectionsOf(...datas) {
  const keys = new Set();
  for (const d of datas) for (const [k, v] of Object.entries(d || {})) if (Array.isArray(v)) keys.add(k);
  return [...keys];
}

// Newest edit wins per record; a deletion wins if it is newer than the record's last edit.
export function merge(a, b) {
  a = a || emptyData(); b = b || emptyData();
  const out = { ...a, ...b, schema: Math.max(a.schema || 1, b.schema || 1), meta: { ...(a.meta || {}), ...(b.meta || {}) } };
  const deleted = { ...(a.deleted || {}) };
  for (const [id, t] of Object.entries(b.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, t);
  out.deleted = deleted;
  for (const key of collectionsOf(a, b)) {
    const map = new Map();
    for (const r of [...(a[key] || []), ...(b[key] || [])]) {
      if (!r || !r.id) continue;
      const cur = map.get(r.id);
      if (!cur || (r.updated || 0) >= (cur.updated || 0)) map.set(r.id, r);
    }
    out[key] = [...map.values()].filter((r) => !(deleted[r.id] && deleted[r.id] >= (r.updated || 0)));
  }
  return out;
}

export function sameData(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
