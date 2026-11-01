// Builds Leaflet layers from the catalog in config.js, plus the live parcel-lines overlay.
import { PARCELS_URL } from './config.js';

const R = 6378137, HALF = Math.PI * R;

// Draws an ArcGIS MapServer (export) or ImageServer (exportImage) as 512px Web Mercator tiles,
// so services published in Wisconsin's own projection still line up with everything else.
const ExportTiles = L.TileLayer.extend({
  initialize(def) {
    this.def = def;
    L.TileLayer.prototype.initialize.call(this, '', { tileSize: 512, zoomOffset: -1, minZoom: def.minZoom || 0, maxZoom: 21, maxNativeZoom: 21, opacity: def.opacity ?? 1, attribution: def.attr });
  },
  getTileUrl(c) {
    // A 512px tile at zoom z covers the same ground as a 256px tile at zoom z-1.
    const n = Math.pow(2, c.z + this.options.zoomOffset), size = (2 * HALF) / n;
    const minx = -HALF + c.x * size, maxx = minx + size, maxy = HALF - c.y * size, miny = maxy - size;
    const bbox = [minx, miny, maxx, maxy].map((v) => v.toFixed(2)).join(',');
    const d = this.def;
    return d.image
      ? `${d.url}/exportImage?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=512,512&format=jpgpng&f=image`
      : `${d.url}/export?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=512,512&dpi=96&format=png32&transparent=true&f=image${d.layers ? '&layers=' + d.layers : ''}`;
  },
});

export function makeLayer(def) {
  if (def.kind === 'stack') return L.layerGroup(def.layers.map(makeLayer));
  if (def.kind === 'export') return new ExportTiles(def);
  return L.tileLayer(def.url, { maxNativeZoom: def.maxNative, maxZoom: 21, minZoom: def.minZoom || 0, opacity: def.opacity ?? 1, attribution: def.attr });
}

// ---- parcels: fetched for the area on screen when zoomed in, drawn as lines, tap for owner ----
export function parcelsLayer(map, onPick) {
  const group = L.layerGroup();
  const cache = new Map(); // OBJECTID -> layer
  let timer = null, ctrl = null, active = false, note = null;
  const style = { color: '#ffe066', weight: 1.6, opacity: 0.95, fillOpacity: 0, fill: true, fillColor: '#ffe066' };

  async function load() {
    if (!active) return;
    if (map.getZoom() < 14) { group.clearLayers(); cache.clear(); return; }
    const b = map.getBounds().pad(0.25);
    if (ctrl) ctrl.abort();
    ctrl = new AbortController();
    const params = new URLSearchParams({
      geometry: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
      outFields: 'OBJECTID,OWNERNME1,OWNERNME2,GISACRES,DEEDACRES,PARCELID,PROPCLASS,CONAME,SITEADRESS', returnGeometry: 'true', outSR: '4326',
      geometryPrecision: '6', maxAllowableOffset: map.getZoom() >= 16 ? '0.000005' : '0.00002', resultRecordCount: '2000', f: 'geojson',
    });
    try {
      const r = await fetch(`${PARCELS_URL}/query?${params}`, { signal: ctrl.signal });
      const gj = await r.json();
      if (gj.error) throw new Error(gj.error.message);
      const keep = new Set();
      for (const f of gj.features || []) {
        const id = f.properties.OBJECTID ?? f.id; keep.add(id);
        if (cache.has(id)) continue;
        const lyr = L.geoJSON(f, { style, interactive: true, bubblingMouseEvents: false });
        lyr.on('click', (e) => { L.DomEvent.stopPropagation(e); onPick(f, e.latlng); });
        cache.set(id, lyr); group.addLayer(lyr); lyr.bringToBack(); // keep stands and areas clickable on top
      }
      for (const [id, lyr] of cache) if (!keep.has(id)) { group.removeLayer(lyr); cache.delete(id); }
      note = null;
    } catch (e) {
      if (e.name !== 'AbortError') note = 'Property lines could not load right now.';
    }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(load, 350); };
  group.onAdd = function (m) { L.LayerGroup.prototype.onAdd.call(this, m); active = true; m.on('moveend', schedule); load(); };
  group.onRemove = function (m) { active = false; m.off('moveend', schedule); group.clearLayers(); cache.clear(); L.LayerGroup.prototype.onRemove.call(this, m); };
  group.problem = () => note;
  group.bringBehindMarks = () => group.eachLayer((l) => l.bringToBack && l.bringToBack());
  return group;
}

// Parcel(s) at a point, used for "set boundary from parcel records".
export async function parcelAt(lat, lng) {
  const params = new URLSearchParams({ geometry: `${lng},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'OBJECTID,OWNERNME1,GISACRES,PARCELID', returnGeometry: 'true', outSR: '4326', geometryPrecision: '7', f: 'geojson' });
  const r = await fetch(`${PARCELS_URL}/query?${params}`);
  const gj = await r.json();
  if (gj.error) throw new Error(gj.error.message);
  return gj.features || [];
}
