// onX (and other) exports: KML, KMZ, GPX, GeoJSON -> candidate features.
import { TYPES } from './config.js';

const RULES = [
  [/ladder|stand|hang|lock.?on|climb|ts\b|saddle hunt/i, 'stand'],
  [/blind|box|hub/i, 'blind'],
  [/cam|spypoint|stealth|cell/i, 'camera'],
  [/scrape/i, 'scrape'],
  [/rub/i, 'rub'],
  [/\bbed/i, 'bed'],
  [/cross/i, 'crossing'],
  [/shed|buck|doe|deer|sighting|seen|shot|kill|hit/i, 'sighting'],
  [/water|creek|pond|spring|seep/i, 'water'],
  [/park|truck|gate|access|entry/i, 'access'],
  [/oak|acorn|corn|bean|clover|plot|apple|food|turnip|brassica/i, 'food'],
];
const AREA_RULES = [
  [/bound|property|parcel|line/i, 'boundary'],
  [/bed|thick|cover|swamp|cedar|tag alder/i, 'bedding'],
  [/plot|field|food|corn|bean|clover|ag\b/i, 'foodarea'],
  [/funnel|pinch|saddle|neck|bottleneck|inside corner/i, 'funnel'],
  [/sanctuary|no.?go|stay out/i, 'sanctuary'],
];

// onX exports carry the icon picked in the app; trust it before guessing from the name.
const ONX_ICONS = {
  'tree stand': 'stand', 'ladder stand': 'stand', 'climber': 'stand', 'hang on': 'stand', 'blind': 'blind', 'ground blind': 'blind',
  'trail cam': 'camera', 'camera': 'camera', 'scrape': 'scrape', 'rub': 'rub', 'bedding area': 'bed', 'bed': 'bed',
  'crossing': 'crossing', 'pinch point': 'crossing', 'funnel': 'crossing',
  'buck whitetail': 'sighting', 'buck': 'sighting', 'doe': 'sighting', 'deer': 'sighting', 'tracks': 'sighting', 'scat': 'sighting', 'blood': 'sighting', 'shed': 'sighting',
  'food source': 'food', 'food plot': 'food', 'water source': 'water', 'water': 'water',
  'parking': 'access', 'truck': 'access', 'gate': 'access', '4x4': 'access', 'camp': 'access', 'cabin': 'access', 'atv': 'access',
};
function guessType(name, geom, icon) {
  if (geom === 'point' && icon && ONX_ICONS[String(icon).toLowerCase()]) return ONX_ICONS[String(icon).toLowerCase()];
  const n = name || '';
  if (geom === 'point') { for (const [re, t] of RULES) if (re.test(n)) return t; return 'waypoint'; }
  if (geom === 'line') return /route|track|path|walk|entry|exit|access|road/i.test(n) ? 'route' : 'trail';
  for (const [re, t] of AREA_RULES) if (re.test(n)) return t;
  return 'areaother';
}

function geomKind(g) {
  if (!g) return null;
  if (g.type === 'Point') return 'point';
  if (g.type === 'LineString' || g.type === 'MultiLineString') return 'line';
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') return 'area';
  return null;
}

function flatten(fc) {
  const out = [];
  for (const f of fc.features || []) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'GeometryCollection') { for (const gg of g.geometries) out.push({ ...f, geometry: gg }); }
    else out.push(f);
  }
  return out;
}

// Drop the altitude so stored coordinates stay [lng, lat].
function strip2d(g) {
  const fix = (c) => (typeof c[0] === 'number' ? [Math.round(c[0] * 1e7) / 1e7, Math.round(c[1] * 1e7) / 1e7] : c.map(fix));
  return { type: g.type, coordinates: fix(g.coordinates) };
}

export async function parseFile(file) {
  const name = file.name.toLowerCase();
  let text;
  if (name.endsWith('.kmz')) {
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    const kml = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith('.kml'));
    if (!kml) throw new Error('No KML inside that KMZ.');
    text = await kml.async('string');
  } else text = await file.text();

  let fc;
  if (name.endsWith('.geojson') || name.endsWith('.json')) fc = JSON.parse(text);
  else {
    const xml = new DOMParser().parseFromString(text, 'text/xml');
    if (xml.getElementsByTagName('parsererror').length) throw new Error('That file could not be read.');
    fc = name.endsWith('.gpx') || xml.documentElement.nodeName === 'gpx' ? window.toGeoJSON.gpx(xml) : window.toGeoJSON.kml(xml);
  }
  return flatten(fc).map((f) => {
    const kind = geomKind(f.geometry);
    if (!kind) return null;
    const p = f.properties || {};
    const nm = (p.name || p.title || '').toString().trim();
    const notes = [p.notes, p.description, p.desc, p.cmt].filter((x) => x && typeof x === 'string').join('\n').replace(/<[^>]+>/g, ' ').trim();
    const t = guessType(nm, kind, p.icon);
    return { name: nm || TYPES[t]?.label || 'Imported', notes, icon: p.icon || null, geometry: strip2d(f.geometry), kind, type: t, time: p.time || null, onxId: p.id || null };
  }).filter(Boolean);
}

export function fingerprint(c) {
  if (c.onxId) return 'onx:' + c.onxId;
  return (c.name || '') + '|' + JSON.stringify(c.geometry.coordinates).slice(0, 80);
}

// ---- export to KML so changes can go back into onX ----
const esc = (s) => String(s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
function coordsKml(cs) { return cs.map((c) => `${c[0]},${c[1]}`).join(' '); }
function geomKml(g) {
  if (g.type === 'Point') return `<Point><coordinates>${g.coordinates[0]},${g.coordinates[1]}</coordinates></Point>`;
  if (g.type === 'LineString') return `<LineString><coordinates>${coordsKml(g.coordinates)}</coordinates></LineString>`;
  if (g.type === 'Polygon') return `<Polygon>${g.coordinates.map((r, i) => `<${i ? 'innerBoundaryIs' : 'outerBoundaryIs'}><LinearRing><coordinates>${coordsKml(r)}</coordinates></LinearRing></${i ? 'innerBoundaryIs' : 'outerBoundaryIs'}>`).join('')}</Polygon>`;
  if (g.type.startsWith('Multi')) return `<MultiGeometry>${g.coordinates.map((c) => geomKml({ type: g.type.slice(5), coordinates: c })).join('')}</MultiGeometry>`;
  return '';
}
export function toKml(title, features) {
  const pm = features.map((f) => `<Placemark><name>${esc(f.name)}</name><description>${esc([TYPES[f.type]?.label, f.notes].filter(Boolean).join(' - '))}</description>${geomKml(f.geometry)}</Placemark>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(title)}</name>\n${pm}\n</Document></kml>\n`;
}
