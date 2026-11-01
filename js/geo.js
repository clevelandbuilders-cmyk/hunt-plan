// Small geometry helpers (coordinates are GeoJSON [lng, lat]).
export function distM(a, b) { // [lat,lng] pairs
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function pointInGeom(pt, g) {
  if (!g) return false;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.some((p) => inRing(pt, p[0]) && !p.slice(1).some((h) => inRing(pt, h)));
}
export function firstCoord(g) {
  let c = g.coordinates;
  while (Array.isArray(c[0])) c = c[0];
  return c;
}
export function centroid(g) {
  if (g.type === 'Point') return g.coordinates;
  const pts = []; const walk = (c) => (typeof c[0] === 'number' ? pts.push(c) : c.forEach(walk)); walk(g.coordinates);
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}
// Which property does a spot belong to: inside a boundary first, else the closest center.
export function propertyFor(properties, g) {
  const c = centroid(g);
  const inside = properties.find((p) => p.boundary && pointInGeom(c, p.boundary));
  if (inside) return inside.id;
  let best = null, bestD = Infinity;
  for (const p of properties) { const d = distM([c[1], c[0]], p.center); if (d < bestD) { bestD = d; best = p.id; } }
  return best;
}
export function acres(g) { // spherical polygon area
  const R = 6378137, toR = Math.PI / 180;
  const ringArea = (r) => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += (r[i + 1][0] - r[i][0]) * toR * (2 + Math.sin(r[i][1] * toR) + Math.sin(r[i + 1][1] * toR)); return Math.abs((s * R * R) / 2); };
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  const m2 = polys.reduce((t, p) => t + ringArea(p[0]) - p.slice(1).reduce((h, r) => h + ringArea(r), 0), 0);
  return m2 / 4046.8564;
}
export function fmtDist(m) { const yd = m * 1.09361; return yd < 1760 ? Math.round(yd) + ' yd' : (m / 1609.34).toFixed(2) + ' mi'; }
