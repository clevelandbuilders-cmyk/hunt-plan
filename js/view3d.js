// 3D terrain view: the same marks drawn on aerial imagery over real elevation (MapLibre GL).
// Loaded only when the 3D button is tapped, so the normal map stays light.
import { TYPES } from './config.js';
import { iconSvg } from './icons.js';

const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'; // free AWS terrain tiles
const ESRI_IMG = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const WI_LEAF_OFF = 'https://dnrmaps.wi.gov/arcgis_image/rest/services/DW_Imagery/EN_Image_Basemap_Latest_Leaf_Off/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=jpgpng&f=image';
const ESRI_ROADS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';

let loading = null;
function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve();
  if (!loading) loading = new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/maplibre/maplibre-gl.css'; document.head.append(css);
    const s = document.createElement('script'); s.src = 'vendor/maplibre/maplibre-gl.js'; s.onload = res; s.onerror = () => { loading = null; rej(new Error('3D map could not load')); };
    document.head.append(s);
  });
  return loading;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// onX auto-names ("Waypoint 11/02/25 15:16") say nothing on the map; real names get a label.
const meaningful = (name) => name && !/^(Waypoint|Track|Route|Area|My Location)\b/i.test(name);

function style(base) {
  return {
    version: 8,
    sources: {
      esri: { type: 'raster', tiles: [ESRI_IMG], tileSize: 256, maxzoom: 19, attribution: 'Esri' },
      leafoff: { type: 'raster', tiles: [WI_LEAF_OFF], tileSize: 512, minzoom: 12, maxzoom: 21, attribution: 'WI DNR, WROC / SEWRPC leaf-off imagery' },
      roads: { type: 'raster', tiles: [ESRI_ROADS], tileSize: 256, maxzoom: 19 },
      dem: { type: 'raster-dem', tiles: [DEM], encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: 'Terrain: Mapzen / AWS Open Data' },
      demShade: { type: 'raster-dem', tiles: [DEM], encoding: 'terrarium', tileSize: 256, maxzoom: 15 },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0b0e09' } },
      { id: 'esri', type: 'raster', source: 'esri' },
      { id: 'leafoff', type: 'raster', source: 'leafoff', layout: { visibility: base === 'leafoff' ? 'visible' : 'none' } },
      { id: 'shade', type: 'hillshade', source: 'demShade', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#000', 'hillshade-highlight-color': '#fff' } },
      { id: 'roads', type: 'raster', source: 'roads', paint: { 'raster-opacity': 0.8 } },
    ],
    terrain: { source: 'dem', exaggeration: 3 },
  };
}

const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

/**
 * Open the 3D view.
 * opts: { features, properties, propId, center: [lat,lng], zoom (Leaflet zoom), onClose }
 */
export async function open3d(opts) {
  const wrap = h('div', 'v3d');
  const mapEl = h('div', 'v3d-map');
  const bar = h('div', 'v3d-bar');
  const close = h('button', 'round', '✕'); close.setAttribute('aria-label', 'Close 3D view');
  const title = h('div', 'v3d-title', '3D terrain');
  bar.append(title, close);
  const ctl = h('div', 'v3d-ctl');
  const exBtn = h('button', 'chip', 'Relief 3×');
  const baseBtn = h('button', 'chip', 'Leaf-off');
  const tiltBtn = h('button', 'chip', 'Flat');
  ctl.append(exBtn, baseBtn, tiltBtn);
  const hint = h('div', 'v3d-hint', 'Drag to move · two fingers to tilt and turn');
  wrap.append(mapEl, bar, ctl, hint);
  document.body.append(wrap);
  const shut = () => { try { map?.remove(); } catch {} wrap.remove(); opts.onClose?.(); };
  close.onclick = shut;

  let map;
  try { await loadMapLibre(); } catch (e) { hint.textContent = e.message + '. Check your connection and try again.'; return; }

  let base = 'leafoff';
  // Start on highlighted marks (e.g. today's setup) if there are any, otherwise where the 2D map was.
  const hi = opts.features.filter((f) => f.props?.highlight && f.geometry.type === 'Point');
  const center = hi.length ? [hi.reduce((s, f) => s + f.geometry.coordinates[0], 0) / hi.length, hi.reduce((s, f) => s + f.geometry.coordinates[1], 0) / hi.length] : [opts.center[1], opts.center[0]];
  map = new maplibregl.Map({
    container: mapEl,
    style: style(base),
    center,
    zoom: hi.length ? 16.3 : Math.max(13, (opts.zoom ?? 16) - 1), // Leaflet zoom z ≈ MapLibre zoom z-1 (256 vs 512 tiles)
    pitch: 62, bearing: 0, maxPitch: 85,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  setTimeout(() => hint.classList.add('fade'), 4000);

  const exSteps = [1, 2, 3, 5];
  let ex = 3;
  exBtn.onclick = () => { ex = exSteps[(exSteps.indexOf(ex) + 1) % exSteps.length]; map.setTerrain({ source: 'dem', exaggeration: ex }); exBtn.textContent = `Relief ${ex}×`; };
  baseBtn.onclick = () => { base = base === 'leafoff' ? 'esri' : 'leafoff'; map.setLayoutProperty('leafoff', 'visibility', base === 'leafoff' ? 'visible' : 'none'); baseBtn.textContent = base === 'leafoff' ? 'Leaf-off' : 'Esri imagery'; };
  tiltBtn.onclick = () => { const flat = map.getPitch() > 5; map.easeTo({ pitch: flat ? 0 : 62, duration: 600 }); tiltBtn.textContent = flat ? '3D' : 'Flat'; };

  const feats = opts.features;
  const shapes = { type: 'FeatureCollection', features: feats.filter((f) => f.geometry.type !== 'Point').map((f) => {
    const t = TYPES[f.type] || TYPES.areaother;
    return { type: 'Feature', geometry: f.geometry, properties: { id: f.id, color: f.props?.color || t.color, route: f.type === 'route' ? 1 : 0, area: t.geom === 'area' ? 1 : 0 } };
  }) };
  const bounds = { type: 'FeatureCollection', features: opts.properties.filter((p) => p.boundary).map((p) => ({ type: 'Feature', geometry: p.boundary, properties: { active: !opts.propId || p.id === opts.propId ? 1 : 0 } })) };

  map.on('load', () => {
    map.addSource('bounds', { type: 'geojson', data: bounds });
    map.addLayer({ id: 'bounds', type: 'line', source: 'bounds', paint: { 'line-color': ['case', ['==', ['get', 'active'], 1], '#ffa94d', '#ffffff'], 'line-width': 3, 'line-dasharray': [3, 2] } });
    map.addSource('shapes', { type: 'geojson', data: shapes });
    map.addLayer({ id: 'areas', type: 'fill', source: 'shapes', filter: ['==', ['get', 'area'], 1], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.3 } });
    map.addLayer({ id: 'area-edge', type: 'line', source: 'shapes', filter: ['==', ['get', 'area'], 1], paint: { 'line-color': ['get', 'color'], 'line-width': 2 } });
    map.addLayer({ id: 'lines-casing', type: 'line', source: 'shapes', filter: ['==', ['get', 'area'], 0], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#000', 'line-width': 7, 'line-opacity': 0.5 } });
    map.addLayer({ id: 'lines', type: 'line', source: 'shapes', filter: ['all', ['==', ['get', 'area'], 0], ['==', ['get', 'route'], 0]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 4 } });
    map.addLayer({ id: 'routes', type: 'line', source: 'shapes', filter: ['==', ['get', 'route'], 1], layout: { 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-dasharray': [2, 1.2] } });
    const tap = (e) => { const f = feats.find((x) => x.id === e.features[0].properties.id); if (f) popup(f, e.lngLat); };
    for (const id of ['areas', 'lines', 'routes']) { map.on('click', id, tap); map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer')); map.on('mouseleave', id, () => (map.getCanvas().style.cursor = '')); }
  });
  map.on('error', (e) => { if (e?.sourceId) return; console.error('3D map:', e?.error?.message || e); });

  function popup(f, lngLat) {
    const t = TYPES[f.type] || TYPES.waypoint;
    new maplibregl.Popup({ maxWidth: '280px', offset: 16 }).setLngLat(lngLat)
      .setHTML(`<b>${esc(f.name)}</b><br><small>${esc(t.label)}</small>${f.notes ? `<p>${esc(f.notes).replace(/\n/g, '<br>')}</p>` : ''}`).addTo(map);
  }

  for (const f of feats.filter((x) => x.geometry.type === 'Point')) {
    const t = TYPES[f.type] || TYPES.waypoint;
    const dim = opts.propId && f.propertyId !== opts.propId;
    const el = h('div', 'v3d-pin' + (dim ? ' dim' : ''));
    const mk = h('div', 'mk' + (f.props?.highlight ? ' sel' : ''), iconSvg(f.type, 17)); mk.style.background = f.props?.color || t.color;
    el.append(mk);
    if (meaningful(f.name) && !dim) el.append(h('span', 'v3d-lbl', esc(f.name)));
    el.addEventListener('click', (e) => { e.stopPropagation(); popup(f, f.geometry.coordinates); });
    new maplibregl.Marker({ element: el, anchor: 'left', offset: [-14, 0] }).setLngLat(f.geometry.coordinates).addTo(map);
  }
  return { map, close: shut };
}
