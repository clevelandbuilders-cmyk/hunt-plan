// Hunt Plan: main UI. Map + per-property sections + marks editing + onX import.
import { BASE_LAYERS, OVERLAYS, DEFAULT_BASE, TYPES, FIELD_DEFS, WINDS, REPO } from './config.js';
import { makeLayer, parcelsLayer, parcelAt } from './layers.js';
import { iconSvg } from './icons.js';
import * as store from './store.js';
import { uid } from './model.js';
import { parseFile, fingerprint, toKml } from './importer.js';
import { propertyFor, acres, distM, centroid, fmtDist, nearestPropertyDist } from './geo.js';
import { checkToken } from './github.js';

const $ = (s) => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
};

const ui = { propId: null, selected: null, mode: null, map: null, base: null, overlays: {}, labels: true, me: null, watch: null };
const data = () => store.state.data;
const props = () => [...data().properties].sort((a, b) => (a.county || '').localeCompare(b.county || '') || (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));
const prop = (id = ui.propId) => data().properties.find((p) => p.id === id);
const featuresOf = (pid) => data().features.filter((f) => !pid || f.propertyId === pid);

// ---------- toast / sheet ----------
let toastT;
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); t.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => { t.style.opacity = 0; setTimeout(() => t.classList.add('hidden'), 300); }, ms); }
let sheetOnClose = null;
function openSheet(title, body, onClose) {
  $('#sheetTitle').textContent = title;
  const b = $('#sheetBody'); b.replaceChildren(body); b.scrollTop = 0;
  $('#sheet').classList.add('open');
  if (sheetOnClose && sheetOnClose !== onClose) { const f = sheetOnClose; sheetOnClose = null; f(); }
  sheetOnClose = onClose || null;
}
function closeSheet() { $('#sheet').classList.remove('open'); if (sheetOnClose) { const f = sheetOnClose; sheetOnClose = null; f(); } }
$('#sheetClose').onclick = closeSheet;

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { prompt('Copy this:', text); }
}
function download(name, text, type = 'application/octet-stream') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const glyph = (type, size) => { const t = TYPES[type] || TYPES.waypoint; const g = h('span', { class: 'glyph', html: iconSvg(type, 20, t.geom) }); g.style.background = t.color; if (size) { g.style.width = g.style.height = size + 'px'; } return g; };
const fmtDate = (ms) => ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

// ---------- lock screen ----------
$('#lockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#unlockBtn').disabled = true; $('#lockErr').textContent = 'Unlocking…';
  const ok = await store.unlock($('#pw').value, $('#remember').checked);
  $('#unlockBtn').disabled = false;
  if (ok) { $('#pw').value = ''; $('#lockErr').textContent = ''; } else $('#lockErr').textContent = store.state.error || 'Could not unlock.';
});

store.on(async (what) => {
  if (what === 'status') {
    const s = store.state.status;
    if (s === 'locked') { $('#app').classList.add('hidden'); $('#lock').classList.remove('hidden'); if (store.state.error) $('#lockErr').textContent = store.state.error; }
    else if (s !== 'unlocking') { $('#lock').classList.add('hidden'); $('#app').classList.remove('hidden'); if (!ui.map) initMap(); }
    renderSync();
  }
  if (what === 'data' && ui.map) render();
});

function renderSync() {
  const d = $('#syncDot'); const s = store.state;
  d.className = s.status === 'syncing' ? 'busy' : s.status === 'error' || s.status === 'offline' ? 'bad' : s.pending ? 'busy' : 'ok';
  $('#fab').classList.toggle('hidden', !store.canEdit() || !!ui.mode);
}
$('#syncBtn').onclick = () => {
  const s = store.state;
  const msg = s.status === 'error' ? 'Not saved yet: ' + s.error : s.status === 'offline' ? 'Offline. Changes are kept on this device and save when you have signal.' : s.pending ? 'Saving…' : store.canEdit() ? 'All changes saved.' : 'Up to date (view only).';
  toast(msg, 4000); store.sync();
};
window.addEventListener('online', () => store.sync());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && store.state.key) store.sync(); });

// ---------- map ----------
// zIndex keeps the base map under overlays no matter which is switched on last.
function zset(layer, z) { if (layer.setZIndex) layer.setZIndex(z); if (layer.eachLayer) { let i = 0; layer.eachLayer((l) => zset(l, z + i++)); } return layer; }

function initMap() {
  const view = store.prefs.view;
  ui.map = L.map('map', { zoomControl: false, attributionControl: true, maxZoom: 21, tap: true }).setView([45.87, -91.66], 14);
  L.control.scale({ imperial: true, metric: false, position: 'bottomleft' }).addTo(ui.map);
  setBase(view.baseV2 || DEFAULT_BASE);
  for (const id of view.overlaysV2 || OVERLAYS.filter((o) => o.default).map((o) => o.id)) toggleOverlay(id, true);
  ui.labels = view.labelsV2 === true; // names on the map are off unless turned on in Map layers
  ui.layer = L.layerGroup().addTo(ui.map);
  ui.propLayer = L.layerGroup().addTo(ui.map);
  ui.drawLayer = L.layerGroup().addTo(ui.map);
  ui.map.on('click', onMapClick);
  ui.map.on('zoomend', () => render());
  const pid = (location.hash.match(/^#p-(.+)$/) || [])[1] || view.prop;
  if (pid && prop(pid)) selectProperty(pid, false); else { render(); openPropertyPicker(); fitAll(); }
  handleEditorLink();
}
function saveView() { store.prefs.view = { baseV2: ui.baseId, overlaysV2: Object.keys(ui.overlays), labelsV2: ui.labels, prop: ui.propId }; }
function setBase(id) { if (ui.base) ui.map.removeLayer(ui.base); const l = BASE_LAYERS.find((x) => x.id === id) || BASE_LAYERS[0]; ui.base = zset(makeLayer(l), 1).addTo(ui.map); ui.baseId = l.id; saveView(); }
function toggleOverlay(id, on) {
  if (ui.overlays[id]) { ui.map.removeLayer(ui.overlays[id]); delete ui.overlays[id]; }
  if (on) { const l = OVERLAYS.find((x) => x.id === id); if (l) ui.overlays[id] = (l.kind === 'parcels' ? parcelsLayer(ui.map, onParcelTap) : zset(makeLayer(l), 50 + OVERLAYS.indexOf(l) * 5)).addTo(ui.map); }
  saveView();
}
function zoomFor(p) { const a = p.acres || 50; return a < 40 ? 17 : a < 150 ? 16 : a < 600 ? 15 : a < 3000 ? 14 : 13; }
function fitProperty(p = prop()) {
  if (!p) return fitAll();
  if (p.boundary) ui.map.fitBounds(L.geoJSON(p.boundary).getBounds(), { padding: [30, 30], maxZoom: 18 });
  else ui.map.setView(p.center, zoomFor(p));
}
function fitAll() {
  const ps = ui.propId ? [prop()] : props();
  if (!ps.length) return;
  const b = L.latLngBounds(ps.map((p) => p.center));
  // Properties are in two far-apart areas; zoom to the cluster the first one is in.
  const near = ps.filter((p) => distM(p.center, ps[0].center) < 30000);
  ui.map.fitBounds(L.latLngBounds(near.map((p) => p.center)).pad(0.6), { maxZoom: 15 });
}
$('#fitBtn').onclick = () => (ui.propId ? fitProperty() : fitAll());

function selectProperty(id, move = true) {
  ui.propId = id;
  $('#propName').textContent = id ? prop(id).name : 'All properties';
  history.replaceState(null, '', id ? '#p-' + id : location.pathname);
  saveView(); render();
  if (move !== false) id ? fitProperty() : fitAll();
  else if (id) fitProperty();
}

function markerIcon(f) {
  const t = TYPES[f.type] || TYPES.waypoint;
  return L.divIcon({ className: '', html: `<div class="mk${ui.selected === f.id ? ' sel' : ''}" style="background:${t.color}">${iconSvg(f.type, 17)}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
}
function render() {
  if (!ui.map) return;
  ui.layer.clearLayers(); ui.propLayer.clearLayers();
  const z = ui.map.getZoom();
  for (const p of props()) {
    const active = !ui.propId || p.id === ui.propId;
    if (p.boundary) {
      L.geoJSON(p.boundary, { style: { color: active ? '#ffa94d' : '#ffffff', weight: active ? 3 : 2, dashArray: '8 6', fill: false, opacity: active ? 1 : 0.5 }, interactive: false }).addTo(ui.propLayer);
    }
    // Name tag: hidden on the property you're in once zoomed close, so it doesn't cover stands.
    if (!(p.id === ui.propId && z >= 16)) {
      const m = L.marker(p.center, { icon: L.divIcon({ className: '', html: `<span class="proplbl">${escapeHtml(p.short || p.name)}</span>`, iconSize: [0, 0] }), keyboard: false, zIndexOffset: -1000 });
      m.on('click', () => selectProperty(p.id));
      m.addTo(ui.propLayer);
    }
  }
  for (const f of data().features) {
    const dim = ui.propId && f.propertyId !== ui.propId;
    const t = TYPES[f.type] || TYPES.waypoint;
    let layer;
    if (f.geometry.type === 'Point') {
      layer = L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], { icon: markerIcon(f), opacity: dim ? 0.55 : 1, draggable: ui.mode?.kind === 'move' && ui.mode.id === f.id });
      if (ui.mode?.kind === 'move' && ui.mode.id === f.id) { ui.mode.marker = layer; }
    } else {
      layer = L.geoJSON(f.geometry, { style: { color: t.color, weight: t.geom === 'line' ? 4 : 2, fillColor: t.color, fillOpacity: t.geom === 'area' ? 0.22 : 0, opacity: dim ? 0.5 : 0.95, dashArray: f.type === 'route' ? '6 6' : f.type === 'sanctuary' ? '2 6' : null } });
    }
    if (ui.labels && f.name && z >= 16 && !dim) layer.bindTooltip(f.name, { permanent: true, direction: f.geometry.type === 'Point' ? 'right' : 'center', offset: f.geometry.type === 'Point' ? [14, 0] : [0, 0], className: 'lbl' });
    layer.on('click', (e) => { if (ui.mode) return; L.DomEvent.stopPropagation(e); showFeature(f.id); });
    layer.addTo(ui.layer);
  }
  renderSync();
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- location ----------
$('#locateBtn').onclick = () => {
  if (ui.watch != null) { navigator.geolocation.clearWatch(ui.watch); ui.watch = null; if (ui.me) { ui.map.removeLayer(ui.me); ui.map.removeLayer(ui.meAcc); ui.me = null; } $('#locateBtn').classList.remove('on'); return; }
  if (!navigator.geolocation) return toast('Location is not available on this device.');
  $('#locateBtn').classList.add('on'); let first = true;
  ui.watch = navigator.geolocation.watchPosition((pos) => {
    const ll = [pos.coords.latitude, pos.coords.longitude];
    ui.lastFix = ll;
    if (!ui.me) { ui.meAcc = L.circle(ll, { radius: pos.coords.accuracy, color: '#339af0', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(ui.map); ui.me = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false }).addTo(ui.map); }
    else { ui.me.setLatLng(ll); ui.meAcc.setLatLng(ll).setRadius(pos.coords.accuracy); }
    if (first) { ui.map.setView(ll, Math.max(ui.map.getZoom(), 16)); first = false; }
  }, (err) => { toast('Could not get your location: ' + err.message); $('#locateBtn').click(); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
};

// ---------- property picker ----------
$('#propBtn').onclick = openPropertyPicker;
function openPropertyPicker() {
  const body = h('div', { class: 'list' });
  let county = null;
  body.append(h('button', { class: 'item' + (!ui.propId ? ' sel' : ''), onclick: () => { selectProperty(null); closeSheet(); } }, h('span', { class: 'glyph', style: 'background:#495057' }, '★'), h('span', { class: 't' }, h('b', {}, 'All properties'), h('small', {}, `${data().properties.length} properties`))));
  for (const p of props()) {
    if (p.county !== county) { county = p.county; body.append(h('div', { class: 'group' }, county || 'Other')); }
    const n = featuresOf(p.id).length;
    body.append(h('button', { class: 'item' + (ui.propId === p.id ? ' sel' : ''), onclick: () => { selectProperty(p.id); closeSheet(); } },
      h('span', { class: 'glyph', style: `background:${p.ownership === 'public' ? '#2f9e44' : '#e8590c'}` }, p.ownership === 'public' ? 'PUB' : 'PVT'),
      h('span', { class: 't' }, h('b', {}, p.name), h('small', {}, [p.acres ? `${p.acres.toLocaleString()} ac` : '', p.area, `${n} mark${n === 1 ? '' : 's'}`, p.boundary ? '' : 'no boundary yet'].filter(Boolean).join(' · ')))));
  }
  if (store.canEdit()) body.append(h('button', { class: 'btn', style: 'margin-top:10px', onclick: () => editProperty(null) }, '+ Add a property'));
  openSheet('Properties', body);
}

// ---------- layers ----------
$('#layersBtn').onclick = () => {
  const body = h('div');
  body.append(h('div', { class: 'group' }, 'Base map'));
  const list = h('div', { class: 'list' });
  for (const l of BASE_LAYERS) list.append(h('button', { class: 'item' + (ui.baseId === l.id ? ' sel' : ''), onclick: () => { setBase(l.id); $('#layersBtn').click(); } }, h('span', { class: 't' }, h('b', {}, l.label), h('small', {}, l.note || l.attr || (l.layers || []).map((x) => x.attr).filter(Boolean).slice(-1)[0] || ''))));
  body.append(list, h('div', { class: 'group' }, 'Overlays'));
  const ol = h('div', { class: 'list' });
  for (const l of OVERLAYS) ol.append(h('button', { class: 'item' + (ui.overlays[l.id] ? ' sel' : ''), onclick: () => { toggleOverlay(l.id, !ui.overlays[l.id]); $('#layersBtn').click(); } }, h('span', { class: 't' }, h('b', {}, (ui.overlays[l.id] ? '✓ ' : '') + l.label))));
  ol.append(h('button', { class: 'item' + (ui.labels ? ' sel' : ''), onclick: () => { ui.labels = !ui.labels; saveView(); render(); $('#layersBtn').click(); } }, h('span', { class: 't' }, h('b', {}, (ui.labels ? '✓ ' : '') + 'Show mark names on the map'))));
  body.append(ol, h('p', { class: 'muted', style: 'font-size:.85rem' }, 'Tip: WI leaf-off shows the woods with no leaves, so trails, benches and thick cover stand out. Add Contour lines or Hillshade to read saddles, ridges and draws. Property lines show once you zoom in close; tap inside one for the owner.'));
  openSheet('Map layers', body);
};

// ---------- list ----------
$('#listBtn').onclick = () => openList();
function openList(q = '') {
  const body = h('div');
  const search = h('input', { type: 'search', placeholder: 'Search marks', value: q });
  const out = h('div', { class: 'list', style: 'margin-top:10px' });
  const draw = () => {
    out.replaceChildren();
    const term = search.value.trim().toLowerCase();
    const fs = featuresOf(ui.propId).filter((f) => !term || (f.name + ' ' + (f.notes || '') + ' ' + TYPES[f.type]?.label).toLowerCase().includes(term));
    if (!fs.length) out.append(h('p', { class: 'muted' }, data().features.length ? 'Nothing here yet.' : store.canEdit() ? 'No marks yet. Tap + to add a stand or camera, or import from onX in the menu.' : 'No marks yet.'));
    const byType = {};
    for (const f of fs) (byType[f.type] = byType[f.type] || []).push(f);
    for (const t of Object.keys(TYPES)) {
      if (!byType[t]) continue;
      out.append(h('div', { class: 'group' }, `${TYPES[t].label} (${byType[t].length})`));
      for (const f of byType[t].sort((a, b) => a.name.localeCompare(b.name))) out.append(h('button', { class: 'item', onclick: () => { zoomTo(f); showFeature(f.id); } }, glyph(f.type), h('span', { class: 't' }, h('b', {}, f.name), h('small', {}, [ui.propId ? '' : prop(f.propertyId)?.name, gradeText(f), f.props?.bestWinds?.length ? 'Winds ' + f.props.bestWinds.join(' ') : ''].filter(Boolean).join(' · ')))));
    }
  };
  search.oninput = draw; draw();
  body.append(search, out);
  openSheet(ui.propId ? `${prop().name} marks` : 'All marks', body);
}
const gradeText = (f) => (f.props?.grade ? '★'.repeat(f.props.grade) : '');
function zoomTo(f) {
  if (f.geometry.type === 'Point') ui.map.setView([f.geometry.coordinates[1], f.geometry.coordinates[0]], Math.max(ui.map.getZoom(), 17));
  else ui.map.fitBounds(L.geoJSON(f.geometry).getBounds(), { padding: [40, 40], maxZoom: 18 });
}

// ---------- feature details ----------
function showFeature(id) {
  const f = data().features.find((x) => x.id === id); if (!f) return;
  ui.selected = id; render();
  const t = TYPES[f.type] || TYPES.waypoint;
  const c = centroid(f.geometry); const ll = [c[1], c[0]];
  const facts = h('dl', { class: 'facts' });
  const fact = (k, v) => { if (v) facts.append(h('dt', {}, k), h('dd', {}, v)); };
  fact('Type', t.label);
  fact('Property', prop(f.propertyId)?.name);
  for (const k of t.fields) {
    const v = f.props?.[k]; if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    fact(FIELD_DEFS[k].label, k === 'grade' ? '★'.repeat(v) + '☆'.repeat(5 - v) : Array.isArray(v) ? v.join(', ') : String(v));
  }
  if (f.geometry.type.includes('Polygon')) fact('Size', acres(f.geometry).toFixed(1) + ' acres');
  if (f.geometry.type === 'LineString') { let d = 0; const cs = f.geometry.coordinates; for (let i = 1; i < cs.length; i++) d += distM([cs[i - 1][1], cs[i - 1][0]], [cs[i][1], cs[i][0]]); fact('Length', fmtDist(d)); }
  if (ui.lastFix) fact('From you', fmtDist(distM(ui.lastFix, ll)));
  fact('GPS', `${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}`);
  fact('Updated', fmtDate(f.updated) + (f.by ? ' by ' + f.by : ''));
  const body = h('div', {}, facts);
  if (f.notes) body.append(h('div', { class: 'notes' }, f.notes));
  const acts = h('div', { class: 'actions' });
  if (store.canEdit()) {
    acts.append(h('button', { class: 'btn primary', onclick: () => editFeature(f) }, 'Edit'));
    if (f.geometry.type === 'Point') acts.append(h('button', { class: 'btn', onclick: () => startMove(f) }, 'Move'));
  }
  acts.append(h('button', { class: 'btn', onclick: () => copyText(`${ll[0].toFixed(6)}, ${ll[1].toFixed(6)}`) }, 'Copy GPS'));
  acts.append(h('a', { class: 'btn', style: 'text-align:center;text-decoration:none', href: `https://www.google.com/maps/dir/?api=1&destination=${ll[0]},${ll[1]}`, target: '_blank', rel: 'noopener' }, 'Directions'));
  if (store.canEdit()) acts.append(h('button', { class: 'btn danger', onclick: () => confirmDelete(f) }, 'Delete'));
  body.append(acts);
  openSheet(f.name, body, () => { ui.selected = null; render(); });
}
function confirmDelete(f) {
  const body = h('div', {}, h('p', {}, `Delete "${f.name}"? Anyone else using the site will see it removed too.`),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => showFeature(f.id) }, 'Keep it'), h('button', { class: 'btn primary', style: 'background:var(--bad);border-color:var(--bad)', onclick: async () => { await store.remove('features', f.id, `Delete ${f.name}`); closeSheet(); toast('Deleted'); } }, 'Delete')));
  openSheet('Delete mark', body);
}

// ---------- edit form ----------
function fieldInput(key, value, onChange) {
  const def = FIELD_DEFS[key];
  const wrap = h('label', { class: 'field' }, h('span', {}, def.label));
  if (def.kind === 'winds') {
    const sel = new Set(value || []); const g = h('div', { class: 'winds' });
    for (const w of WINDS) { const b = h('button', { type: 'button', class: sel.has(w) ? 'on' : '' }, w); b.onclick = (e) => { e.preventDefault(); sel.has(w) ? sel.delete(w) : sel.add(w); b.classList.toggle('on'); onChange(WINDS.filter((x) => sel.has(x))); }; g.append(b); }
    wrap.append(g); return wrap;
  }
  if (def.kind === 'grade') {
    let cur = value || 0; const g = h('div', { class: 'grades' });
    const btns = [1, 2, 3, 4, 5].map((n) => h('button', { type: 'button' }, '★'.repeat(n)));
    const paint = () => btns.forEach((b, i) => b.classList.toggle('on', i + 1 === cur));
    btns.forEach((b, i) => { b.onclick = (e) => { e.preventDefault(); cur = cur === i + 1 ? 0 : i + 1; paint(); onChange(cur || null); }; g.append(b); });
    paint(); wrap.append(g, h('small', { class: 'muted' }, '5 = best. Tap again to clear.')); return wrap;
  }
  let input;
  if (def.kind === 'select') { input = h('select', {}, def.options.map((o) => h('option', { value: o, selected: o === (value || '') }, o || '—'))); }
  else input = h('input', { type: def.kind === 'number' ? 'number' : def.kind === 'date' ? 'date' : 'text', value: value ?? '', inputmode: def.kind === 'number' ? 'numeric' : null });
  input.onchange = input.oninput = () => onChange(def.kind === 'number' ? (input.value ? Number(input.value) : null) : input.value);
  wrap.append(input); return wrap;
}

function editFeature(f, isNew = false) {
  const draft = JSON.parse(JSON.stringify(f)); draft.props = draft.props || {};
  const body = h('form');
  const name = h('input', { type: 'text', value: draft.name || '', placeholder: 'Name', required: true });
  const geom = TYPES[draft.type]?.geom || 'point';
  const typeSel = h('select', {}, Object.entries(TYPES).filter(([, t]) => t.geom === geom).map(([k, t]) => h('option', { value: k, selected: k === draft.type }, t.label)));
  const propSel = h('select', {}, props().map((p) => h('option', { value: p.id, selected: p.id === draft.propertyId }, p.name)));
  const notes = h('textarea', { placeholder: 'Notes: sign seen, how deer move here, entry route…' }, draft.notes || '');
  const extra = h('div');
  const drawExtra = () => { extra.replaceChildren(...(TYPES[draft.type]?.fields || []).map((k) => fieldInput(k, draft.props[k], (v) => { draft.props[k] = v; }))); };
  typeSel.onchange = () => { const oldLabel = TYPES[draft.type]?.label; draft.type = typeSel.value; if (!name.value || name.value.startsWith(oldLabel)) name.value = nextName(draft.type, draft.propertyId); drawExtra(); };
  drawExtra();
  body.append(
    h('label', { class: 'field' }, h('span', {}, 'Name'), name),
    h('label', { class: 'field' }, h('span', {}, 'Type'), typeSel),
    h('label', { class: 'field' }, h('span', {}, 'Property'), propSel),
    extra,
    h('label', { class: 'field' }, h('span', {}, 'Notes'), notes),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => (isNew ? closeSheet() : showFeature(f.id)) }, 'Cancel'), h('button', { class: 'btn primary' }, 'Save')));
  body.onsubmit = async (e) => {
    e.preventDefault();
    for (const k of Object.keys(draft.props)) if (!(TYPES[draft.type].fields || []).includes(k)) delete draft.props[k];
    Object.assign(draft, { name: name.value.trim() || TYPES[draft.type].label, notes: notes.value.trim(), propertyId: propSel.value, by: store.prefs.name || draft.by || '' });
    await store.upsert('features', draft, `${isNew ? 'Add' : 'Edit'} ${draft.name}`);
    toast(isNew ? 'Added' : 'Saved');
    showFeature(draft.id);
  };
  openSheet(isNew ? 'New ' + TYPES[draft.type].label.toLowerCase() : 'Edit ' + f.name, body);
  if (isNew) setTimeout(() => name.select(), 250);
}
function nextName(type, pid) {
  const label = TYPES[type].label; const n = data().features.filter((f) => f.type === type && f.propertyId === pid).length + 1;
  return `${label} ${n}`;
}

// ---------- adding ----------
$('#fab').onclick = () => {
  const body = h('div');
  for (const [geom, title] of [['point', 'Spot on the map'], ['line', 'Line (tap points)'], ['area', 'Area (tap corners)']]) {
    body.append(h('div', { class: 'group' }, title));
    const g = h('div', { class: 'typegrid' });
    for (const [k, t] of Object.entries(TYPES)) if (t.geom === geom) g.append(h('button', { onclick: () => startAdd(k) }, glyph(k), t.label));
    body.append(g);
  }
  openSheet('Add to map', body);
};

function banner(text, buttons) {
  const b = $('#banner'); b.replaceChildren(h('p', {}, text), h('div', { class: 'row' }, buttons)); b.classList.remove('hidden');
}
function endMode() { ui.mode = null; $('#banner').classList.add('hidden'); $('#crosshair').classList.add('hidden'); ui.drawLayer.clearLayers(); render(); }

function startAdd(type) {
  closeSheet();
  const t = TYPES[type];
  if (!ui.propId && !data().properties.length) return toast('Add a property first.');
  if (t.geom === 'point') {
    ui.mode = { kind: 'place', type };
    $('#crosshair').classList.remove('hidden');
    const buttons = [h('button', { class: 'btn', onclick: endMode }, 'Cancel')];
    if (ui.lastFix) buttons.push(h('button', { class: 'btn', onclick: () => { ui.map.setView(ui.lastFix); } }, 'My GPS'));
    buttons.push(h('button', { class: 'btn primary', onclick: () => { const c = ui.map.getCenter(); finishPoint(type, [c.lng, c.lat]); } }, 'Place here'));
    banner(`Move the map so the crosshair is on the ${t.label.toLowerCase()}, or tap the spot.`, buttons);
  } else {
    ui.mode = { kind: 'draw', type, pts: [] };
    drawPreview();
  }
  renderSync();
}
function finishPoint(type, coord) {
  endMode();
  const geometry = { type: 'Point', coordinates: [round7(coord[0]), round7(coord[1])] };
  const propertyId = pickProperty(geometry);
  editFeature({ id: uid(), type, name: nextName(type, propertyId), geometry, propertyId, props: {}, notes: '', created: Date.now() }, true);
}
const round7 = (x) => Math.round(x * 1e7) / 1e7;
function pickProperty(geometry) {
  const auto = propertyFor(data().properties, geometry);
  // If the spot is far from every property center and none has a boundary, prefer the one being viewed.
  return ui.propId && !prop(ui.propId).boundary ? ui.propId : auto || ui.propId;
}
function drawPreview() {
  const m = ui.mode; const t = TYPES[m.type];
  ui.drawLayer.clearLayers();
  const lls = m.pts.map((p) => [p[1], p[0]]);
  if (lls.length > 1) (m.forBoundary || t.geom === 'area' ? L.polygon(lls, { color: m.forBoundary ? '#ffa94d' : t.color, weight: 3, fillOpacity: 0.2, interactive: false }) : L.polyline(lls, { color: t.color, weight: 4, interactive: false })).addTo(ui.drawLayer);
  for (const ll of lls) L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="vtx"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }), interactive: false }).addTo(ui.drawLayer);
  const need = m.forBoundary || t.geom === 'area' ? 3 : 2;
  banner(m.pts.length ? `${m.pts.length} point${m.pts.length === 1 ? '' : 's'}. Keep tapping, then Done.` : `Tap the map to draw the ${m.forBoundary ? 'property boundary' : t.label.toLowerCase()}.`, [
    h('button', { class: 'btn', onclick: () => { endMode(); if (m.forBoundary) editProperty(m.forBoundary); } }, 'Cancel'),
    h('button', { class: 'btn', disabled: !m.pts.length, onclick: () => { m.pts.pop(); drawPreview(); } }, 'Undo'),
    h('button', { class: 'btn primary', disabled: m.pts.length < need, onclick: finishDraw }, 'Done')]);
}
function finishDraw() {
  const m = ui.mode; const t = TYPES[m.type];
  const pts = m.pts.map((p) => [round7(p[0]), round7(p[1])]);
  const area = m.forBoundary || t.geom === 'area';
  const geometry = area ? { type: 'Polygon', coordinates: [[...pts, pts[0]]] } : { type: 'LineString', coordinates: pts };
  endMode();
  if (m.forBoundary) { const p = prop(m.forBoundary); saveBoundary(p, geometry); return; }
  const propertyId = pickProperty(geometry);
  editFeature({ id: uid(), type: m.type, name: nextName(m.type, propertyId), geometry, propertyId, props: {}, notes: '', created: Date.now() }, true);
}
function onMapClick(e) {
  if (!ui.mode) { if ($('#sheet').classList.contains('open') && window.innerWidth < 900) closeSheet(); return; }
  if (ui.mode.kind === 'place') { ui.map.panTo(e.latlng); finishPoint(ui.mode.type, [e.latlng.lng, e.latlng.lat]); }
  else if (ui.mode.kind === 'draw') { ui.mode.pts.push([e.latlng.lng, e.latlng.lat]); drawPreview(); }
}
function startMove(f) {
  closeSheet();
  ui.mode = { kind: 'move', id: f.id }; render();
  banner('Drag the mark to its new spot.', [h('button', { class: 'btn', onclick: () => { endMode(); showFeature(f.id); } }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => {
    const ll = ui.mode.marker.getLatLng(); endMode();
    const nf = { ...f, geometry: { type: 'Point', coordinates: [round7(ll.lng), round7(ll.lat)] }, by: store.prefs.name || f.by };
    await store.upsert('features', nf, `Move ${f.name}`); toast('Moved'); showFeature(f.id);
  } }, 'Save spot')]);
  renderSync();
}


// ---------- parcels (WI statewide property lines) ----------
function onParcelTap(f, latlng) {
  if (ui.mode) return onMapClick({ latlng });
  if ($('#sheet').classList.contains('open') && window.innerWidth < 900) return closeSheet();
  const p = f.properties || {};
  const ac = p.GISACRES || p.DEEDACRES;
  const facts = h('dl', { class: 'facts' });
  const fact = (k, v) => { if (v) facts.append(h('dt', {}, k), h('dd', {}, String(v))); };
  fact('Owner', [p.OWNERNME1, p.OWNERNME2].filter(Boolean).join(' & '));
  fact('Acres', ac ? Number(ac).toFixed(2) : '');
  fact('Parcel', p.PARCELID); fact('County', p.CONAME); fact('Class', p.PROPCLASS); fact('Address', p.SITEADRESS);
  const body = h('div', {}, facts, h('p', { class: 'muted', style: 'font-size:.85rem' }, 'From the Wisconsin statewide parcel map. Always confirm boundaries and permission on the ground.'));
  if (store.canEdit() && data().properties.length) {
    const sel = h('select', {}, props().map((x) => h('option', { value: x.id, selected: x.id === (ui.propId || propertyFor(data().properties, f.geometry)) }, x.name)));
    body.append(h('div', { class: 'card' }, h('h3', {}, 'Use as a property boundary'), h('p', {}, 'Adds this parcel to the boundary line of one of your properties. Do it once for each parcel the property covers.'), sel,
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'btn small primary', onclick: () => addParcelToBoundary(sel.value, f.geometry, false) }, 'Add to boundary'),
        h('button', { class: 'btn small', onclick: () => addParcelToBoundary(sel.value, f.geometry, true) }, 'Replace boundary'))));
  }
  openSheet(p.OWNERNME1 || 'Parcel', body);
}
function polysOf(g) { return !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; }
async function addParcelToBoundary(pid, geometry, replace) {
  const p = prop(pid); if (!p) return;
  const parts = [...(replace ? [] : polysOf(p.boundary)), ...polysOf(geometry)];
  const g = parts.length === 1 ? { type: 'Polygon', coordinates: parts[0] } : { type: 'MultiPolygon', coordinates: parts };
  await saveBoundary(p, g);
  closeSheet();
}
async function boundaryFromParcels(p) {
  toast('Looking up parcel records…');
  try {
    const fs = await parcelAt(p.center[0], p.center[1]);
    if (!fs.length) return toast('No parcel found at the property center. Zoom in and tap the parcel instead.', 5000);
    await saveBoundary(p, fs[0].geometry);
    toast(`Boundary set from parcel ${fs[0].properties.PARCELID || ''} (${fs[0].properties.OWNERNME1 || 'owner unknown'}). Add more parcels by tapping them.`, 6000);
  } catch (e) { toast('Parcel lookup failed: ' + e.message, 5000); }
}

// ---------- properties ----------
function editProperty(id) {
  const p = id ? JSON.parse(JSON.stringify(prop(id))) : { id: uid('p'), name: '', county: '', area: '', acres: null, ownership: 'private', center: ui.map.getCenter() && [round7(ui.map.getCenter().lat), round7(ui.map.getCenter().lng)], notes: '', boundary: null };
  const f = h('form');
  const inp = (label, key, type = 'text') => { const i = h('input', { type, value: p[key] ?? '' }); i.oninput = () => (p[key] = type === 'number' ? (i.value ? Number(i.value) : null) : i.value); return h('label', { class: 'field' }, h('span', {}, label), i); };
  const own = h('select', {}, h('option', { value: 'private', selected: p.ownership === 'private' }, 'Private (permission)'), h('option', { value: 'public', selected: p.ownership === 'public' }, 'Public land'));
  own.onchange = () => (p.ownership = own.value);
  const notes = h('textarea', { placeholder: 'Landowner contact, rules, parking, who hunts it…' }, p.notes || ''); notes.oninput = () => (p.notes = notes.value);
  const bcard = h('div', { class: 'card' }, h('h3', {}, 'Boundary'), h('p', {}, p.boundary ? `Set (${acres(p.boundary).toFixed(1)} acres drawn).` : 'Not set. Get it from the parcel records (or tap parcels on the map), import it from onX, or draw it.'),
    h('div', { class: 'row' }, id ? h('button', { type: 'button', class: 'btn small', onclick: () => { closeSheet(); selectProperty(id); ui.mode = { kind: 'draw', type: 'areaother', pts: [], forBoundary: id }; drawPreview(); renderSync(); } }, p.boundary ? 'Redraw' : 'Draw boundary') : h('span', { class: 'muted' }, 'Save first, then draw.'),
      id ? h('button', { type: 'button', class: 'btn small', onclick: () => { closeSheet(); boundaryFromParcels(p); } }, 'From parcel records') : null,
      p.boundary ? h('button', { type: 'button', class: 'btn small danger', onclick: async () => { p.boundary = null; await store.upsert('properties', p, `Clear boundary ${p.name}`); editProperty(id); } }, 'Clear') : null));
  const center = h('p', { class: 'muted', style: 'font-size:.85rem' }, `Center: ${p.center[0].toFixed(5)}, ${p.center[1].toFixed(5)}  `, h('button', { type: 'button', class: 'btn small', onclick: () => { const c = ui.map.getCenter(); p.center = [round7(c.lat), round7(c.lng)]; center.firstChild.textContent = `Center: ${p.center[0].toFixed(5)}, ${p.center[1].toFixed(5)}  `; } }, 'Use map center'));
  f.append(inp('Name', 'name'), inp('Short label on map', 'short'), inp('County', 'county'), inp('Area / nearest town', 'area'), inp('Acres', 'acres', 'number'), h('label', { class: 'field' }, h('span', {}, 'Ownership'), own), h('label', { class: 'field' }, h('span', {}, 'Notes'), notes), center, bcard,
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: closeSheet }, 'Cancel'), h('button', { class: 'btn primary' }, 'Save')));
  if (id) f.append(h('button', { type: 'button', class: 'btn danger', style: 'margin-top:14px;width:100%', onclick: () => confirmDeleteProperty(p) }, 'Delete property'));
  f.onsubmit = async (e) => { e.preventDefault(); if (!p.name.trim()) return toast('Give it a name'); await store.upsert('properties', p, `${id ? 'Edit' : 'Add'} property ${p.name}`); toast('Saved'); selectProperty(p.id); closeSheet(); };
  openSheet(id ? 'Edit ' + p.name : 'New property', f);
}
async function saveBoundary(p, geometry) {
  const np = { ...p, boundary: geometry, center: (() => { const c = centroid(geometry); return [round7(c[1]), round7(c[0])]; })() };
  await store.upsert('properties', np, `Boundary for ${p.name}`); toast(`Boundary saved (${acres(geometry).toFixed(1)} ac)`); selectProperty(p.id);
}
function confirmDeleteProperty(p) {
  const n = featuresOf(p.id).length;
  openSheet('Delete property', h('div', {}, h('p', {}, `Delete ${p.name}${n ? ` and its ${n} marks` : ''}? This removes it for everyone.`),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => editProperty(p.id) }, 'Keep it'), h('button', { class: 'btn primary', style: 'background:var(--bad);border-color:var(--bad)', onclick: async () => {
      await store.change((d) => { const now = Date.now(); d.deleted = d.deleted || {}; for (const f of d.features.filter((x) => x.propertyId === p.id)) d.deleted[f.id] = now; d.features = d.features.filter((x) => x.propertyId !== p.id); d.properties = d.properties.filter((x) => x.id !== p.id); d.deleted[p.id] = now; }, `Delete property ${p.name}`);
      selectProperty(null); closeSheet();
    } }, 'Delete'))));
}

// ---------- import ----------
function pickFile() {
  const i = h('input', { type: 'file', accept: '.kml,.kmz,.gpx,.geojson,.json,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz,application/gpx+xml', class: 'hidden' });
  i.onchange = async () => { const file = i.files[0]; i.remove(); if (!file) return; try { importPreview(file.name, await parseFile(file)); } catch (e) { toast('Import failed: ' + e.message, 5000); } };
  document.body.append(i); i.click();
}
function importPreview(fileName, cands) {
  if (!cands.length) return toast('No waypoints, lines or areas found in that file.');
  const have = new Set(data().features.map((f) => f.fingerprint).filter(Boolean));
  let assign = 'auto';
  // Markers more than ~5 miles from every property are left unchecked (other spots in the same onX account).
  const rows = cands.map((c) => { const dup = have.has(fingerprint(c)); const far = nearestPropertyDist(data().properties, c.geometry) > 8000; return { c, on: !dup && !far, type: c.type, dup, far }; }).sort((a, b) => a.far - b.far);
  const body = h('div');
  const assignSel = h('select', {}, h('option', { value: 'auto' }, 'Automatic (by location)'), props().map((p) => h('option', { value: p.id, selected: p.id === ui.propId }, p.name)));
  if (ui.propId) assign = ui.propId;
  assignSel.onchange = () => { assign = assignSel.value; draw(); };
  const list = h('div', { class: 'list' });
  const draw = () => {
    list.replaceChildren();
    for (const r of rows) {
      const geom = r.c.kind; const opts = Object.entries(TYPES).filter(([, t]) => t.geom === geom);
      const sel = h('select', { style: 'width:auto;padding:6px;font-size:14px' }, opts.map(([k, t]) => h('option', { value: k, selected: k === r.type }, t.label)), geom === 'area' ? h('option', { value: 'boundary', selected: r.type === 'boundary' }, '→ Property boundary') : null);
      sel.onchange = () => (r.type = sel.value);
      const cb = h('input', { type: 'checkbox', checked: r.on, style: 'width:22px;height:22px' }); cb.onchange = () => (r.on = cb.checked);
      const pid = assign === 'auto' ? propertyFor(data().properties, r.c.geometry) : assign;
      list.append(h('div', { class: 'item' }, cb, h('span', { class: 't' }, h('b', {}, r.c.name), h('small', {}, [r.far && assign === 'auto' ? 'far from your properties' : prop(pid)?.name, r.dup ? 'already imported' : ''].filter(Boolean).join(' · '))), sel));
    }
  };
  draw();
  const nFar = rows.filter((r) => r.far).length;
  body.append(h('p', { class: 'muted' }, `${cands.length} items in ${fileName}. Types come from the onX icon or the name; change any that are wrong.${nFar ? ` ${nFar} are far from every property and are unchecked.` : ''}`),
    h('label', { class: 'field' }, h('span', {}, 'Put them on'), assignSel), list,
    h('div', { class: 'actions', style: 'margin-top:14px' }, h('button', { class: 'btn', onclick: closeSheet }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => {
      const chosen = rows.filter((r) => r.on); if (!chosen.length) return toast('Nothing selected');
      let nb = 0;
      await store.change((d) => {
        const now = Date.now();
        for (const r of chosen) {
          const pid = assign === 'auto' ? propertyFor(d.properties, r.c.geometry) : assign;
          if (r.type === 'boundary') {
            const p = d.properties.find((x) => x.id === pid);
            if (p) { const c = centroid(r.c.geometry); Object.assign(p, { boundary: r.c.geometry, center: [round7(c[1]), round7(c[0])], updated: now }); nb++; }
            continue;
          }
          d.features.push({ id: uid(), type: r.type, name: r.c.name, notes: r.c.notes, geometry: r.c.geometry, propertyId: pid, props: r.c.time ? { seen: String(r.c.time).slice(0, 10) } : {}, source: 'import:' + fileName, fingerprint: fingerprint(r.c), onxIcon: r.c.icon || undefined, by: store.prefs.name || '', created: now, updated: now });
        }
      }, `Import ${chosen.length} from ${fileName}`);
      closeSheet(); toast(`Imported ${chosen.length - nb} marks${nb ? ` and ${nb} boundary` : ''}`); fitAll();
      if (ui.propId) fitProperty();
    } }, 'Import')));
  openSheet('Import from onX', body);
}

// ---------- menu / settings ----------
$('#menuBtn').onclick = openMenu;
function openMenu() {
  const s = store.state; const body = h('div');
  const editor = store.canEdit();
  const nameIn = h('input', { type: 'text', value: store.prefs.name, placeholder: 'e.g. Dan' }); nameIn.onchange = () => (store.prefs.name = nameIn.value.trim());
  body.append(h('label', { class: 'field' }, h('span', {}, 'Your name (shows on edits)'), nameIn));

  body.append(h('div', { class: 'card' }, h('h3', {}, 'onX'), h('p', {}, 'In onX, export your waypoints, lines or areas as KML or GPX, then pick the file here. Export sends marks back the other way.'),
    h('div', { class: 'row' }, editor ? h('button', { class: 'btn small primary', onclick: pickFile }, 'Import file') : h('span', { class: 'muted' }, 'Importing needs editor access. '),
      h('button', { class: 'btn small', onclick: () => { const ps = ui.propId ? [prop()] : props(); const fs = featuresOf(ui.propId); const bounds = ps.filter((p) => p.boundary).map((p) => ({ name: p.name + ' boundary', geometry: p.boundary, type: 'areaother' })); download(`hunt-plan-${ui.propId || 'all'}.kml`, toKml('Hunt Plan', [...bounds, ...fs]), 'application/vnd.google-earth.kml+xml'); } }, 'Export KML'),
      h('button', { class: 'btn small', onclick: () => download(`hunt-plan-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data(), null, 1), 'application/json') }, 'Backup'))));

  if (editor) {
    body.append(h('div', { class: 'card' }, h('h3', {}, 'Properties'), h('div', { class: 'row' }, ui.propId ? h('button', { class: 'btn small', onclick: () => editProperty(ui.propId) }, 'Edit ' + prop().name) : null, h('button', { class: 'btn small', onclick: () => editProperty(null) }, 'Add property'))));
    body.append(h('div', { class: 'card' }, h('h3', {}, 'Editor access: on'), h('p', {}, 'Send an editor link to someone you want to let edit. They still need the password, so the link alone does nothing.'),
      h('div', { class: 'row' }, h('button', { class: 'btn small primary', onclick: async () => copyText(await store.makeEditorLink()) }, 'Copy editor link'), h('button', { class: 'btn small', onclick: changePasswordForm }, 'Change password'), h('button', { class: 'btn small danger', onclick: async () => { await store.setToken(null); toast('This device is view-only now'); openMenu(); } }, 'Turn off here'))));
  } else {
    const tok = h('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off' });
    body.append(h('div', { class: 'card' }, h('h3', {}, 'Editor access: off'), h('p', {}, 'You can look but not change anything. Open the editor link you were sent, or paste a GitHub key for this repo.'),
      tok, h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn small primary', onclick: async () => { const t = tok.value.trim(); if (!t) return; toast('Checking key…'); const r = await checkToken(t); if (!r.ok) return toast(r.reason, 6000); await store.setToken(t); toast('Editor access on'); render(); openMenu(); } }, 'Use key'),
        h('a', { class: 'btn small', target: '_blank', rel: 'noopener', href: `https://github.com/settings/personal-access-tokens/new?name=hunt-plan+editor&description=Edit+Hunt+Plan&target_name=${REPO.owner}&expires_in=366&contents=write` }, 'Make a key on GitHub'))));
  }
  body.append(h('div', { class: 'card' }, h('h3', {}, 'Sync'), h('p', {}, s.status === 'error' ? 'Problem: ' + s.error : s.pending ? 'Some changes are only on this device so far.' : 'Up to date' + (s.lastSync ? ' as of ' + s.lastSync.toLocaleTimeString() : '') + '.'),
    h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: async () => { await store.sync(); openMenu(); } }, 'Sync now'), h('button', { class: 'btn small', onclick: () => store.lock() }, 'Lock this device'))));
  openSheet('Menu', body);
}
function changePasswordForm() {
  const a = h('input', { type: 'password', placeholder: 'New password', autocomplete: 'new-password' }); const b = h('input', { type: 'password', placeholder: 'Type it again', autocomplete: 'new-password' });
  const f = h('form', {}, h('p', { class: 'muted' }, 'Everyone will need the new password. Old editor links stop working, so send new ones.'), h('div', { class: 'field' }, a), h('div', { class: 'field' }, b), h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: openMenu }, 'Cancel'), h('button', { class: 'btn primary' }, 'Change')));
  f.onsubmit = async (e) => { e.preventDefault(); if (a.value.length < 8) return toast('Use at least 8 characters'); if (a.value !== b.value) return toast('Those do not match'); try { toast('Re-encrypting…'); await store.changePassword(a.value); toast('Password changed'); openMenu(); } catch (err) { toast(err.message, 5000); } };
  openSheet('Change password', f);
}

async function handleEditorLink() {
  const m = location.hash.match(/^#edit=(.+)$/); if (!m) return;
  const r = await store.acceptEditorPayload(m[1]);
  history.replaceState(null, '', location.pathname + (ui.propId ? '#p-' + ui.propId : ''));
  toast(r.ok ? 'Editor access is on for this device.' : r.reason, 5000);
  render();
}
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#edit=')) handleEditorLink(); else { const m = location.hash.match(/^#p-(.+)$/); if (m && prop(m[1]) && m[1] !== ui.propId) selectProperty(m[1]); } });

// ---------- start ----------
(async () => {
  if (!(await store.autoUnlock())) { $('#lock').classList.remove('hidden'); setTimeout(() => $('#pw').focus(), 50); }
})();
