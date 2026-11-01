// Site-wide settings. Change REPO if the GitHub repo is renamed or moved.
export const REPO = { owner: 'clevelandbuilders-cmyk', name: 'hunt-plan', branch: 'main' };
export const VAULT_PATH = 'data/vault.json';

// Map layers. All free, no API key. maxNative = deepest zoom the source has; Leaflet upscales past it.
export const BASE_LAYERS = [
  { id: 'imagery-topo', label: 'Satellite + contours', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}', maxNative: 16, attr: 'USGS The National Map' },
  { id: 'satellite', label: 'Satellite (sharpest)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxNative: 19, attr: 'Esri, Maxar, Earthstar Geographics' },
  { id: 'usgs-topo', label: 'USGS topo', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', maxNative: 16, attr: 'USGS The National Map' },
  { id: 'esri-topo', label: 'Topo (detailed)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', maxNative: 19, attr: 'Esri, USGS, NOAA' },
];
export const OVERLAYS = [
  { id: 'hillshade', label: 'Hillshade (ridges & draws)', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}', maxNative: 16, opacity: 0.45, attr: 'USGS' },
  { id: 'labels', label: 'Roads & place names', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', maxNative: 19, opacity: 0.9, attr: 'Esri' },
];

export const WINDS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// Feature types. geom: point | line | area. fields: extra per-type inputs.
// "grade" is used by the scouting step to rank funnels, stands and crossings.
export const TYPES = {
  stand:     { label: 'Tree stand',   geom: 'point', glyph: 'TS', color: '#e8590c', fields: ['bestWinds', 'timeOfDay', 'height', 'grade', 'access'] },
  blind:     { label: 'Ground blind', geom: 'point', glyph: 'GB', color: '#d9480f', fields: ['bestWinds', 'timeOfDay', 'grade', 'access'] },
  camera:    { label: 'Trail camera', geom: 'point', glyph: '📷', color: '#1971c2', fields: ['brand', 'camName', 'facing'] },
  scrape:    { label: 'Scrape',       geom: 'point', glyph: 'S',  color: '#862e9c', fields: ['seen'] },
  rub:       { label: 'Rub',          geom: 'point', glyph: 'R',  color: '#9c36b5', fields: ['seen'] },
  bed:       { label: 'Bed',          geom: 'point', glyph: 'B',  color: '#5c940d', fields: ['seen'] },
  crossing:  { label: 'Crossing',     geom: 'point', glyph: 'X',  color: '#c92a2a', fields: ['grade'] },
  food:      { label: 'Food source',  geom: 'point', glyph: '🌽', color: '#e67700', fields: ['food'] },
  water:     { label: 'Water',        geom: 'point', glyph: '💧', color: '#1c7ed6', fields: [] },
  sighting:  { label: 'Deer sighting',geom: 'point', glyph: '🦌', color: '#a61e4d', fields: ['seen'] },
  access:    { label: 'Parking / access', geom: 'point', glyph: 'P', color: '#495057', fields: [] },
  waypoint:  { label: 'Waypoint',     geom: 'point', glyph: '•',  color: '#343a40', fields: [] },
  trail:     { label: 'Deer trail',   geom: 'line',  color: '#a5d8ff', fields: ['grade'] },
  route:     { label: 'Access route', geom: 'line',  color: '#ffd43b', fields: [] },
  bedding:   { label: 'Bedding area', geom: 'area',  color: '#82c91e', fields: ['grade'] },
  foodarea:  { label: 'Food plot / field', geom: 'area', color: '#fab005', fields: ['food'] },
  funnel:    { label: 'Funnel / pinch', geom: 'area', color: '#ff6b6b', fields: ['grade'] },
  sanctuary: { label: 'Sanctuary (stay out)', geom: 'area', color: '#e03131', fields: [] },
  areaother: { label: 'Other area',   geom: 'area',  color: '#adb5bd', fields: [] },
};

export const FIELD_DEFS = {
  bestWinds: { label: 'Good winds', kind: 'winds' },
  timeOfDay: { label: 'Best time', kind: 'select', options: ['', 'Morning', 'Evening', 'All day'] },
  height:    { label: 'Height (ft)', kind: 'number' },
  grade:     { label: 'Grade', kind: 'grade' },
  access:    { label: 'Entry / exit notes', kind: 'text' },
  brand:     { label: 'Brand', kind: 'select', options: ['', 'Spypoint', 'Stealth Cam', 'Other'] },
  camName:   { label: 'Name in camera app', kind: 'text' },
  facing:    { label: 'Facing', kind: 'select', options: ['', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] },
  seen:      { label: 'Date seen', kind: 'date' },
  food:      { label: 'Food type', kind: 'select', options: ['', 'Acorns (white oak)', 'Acorns (red oak)', 'Standing corn', 'Picked corn', 'Soybeans', 'Alfalfa / clover', 'Brassicas / turnips', 'Winter wheat / rye', 'Browse / clearcut', 'Apples', 'Other'] },
};
