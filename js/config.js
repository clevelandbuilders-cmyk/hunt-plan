// Site-wide settings. Change REPO if the GitHub repo is renamed or moved.
export const REPO = { owner: 'clevelandbuilders-cmyk', name: 'hunt-plan', branch: 'main' };
export const VAULT_PATH = 'data/vault.json';

// Map layers. All free, no API key.
// kind: xyz (tile template) | export (ArcGIS MapServer/ImageServer drawn per tile) | stack (several layers together)
// maxNative = deepest zoom the source has; Leaflet upscales past it.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const USGS = 'https://basemap.nationalmap.gov/arcgis/rest/services/';
const esri = (path, maxNative, extra = {}) => ({ kind: 'xyz', url: `${ESRI}${path}/MapServer/tile/{z}/{y}/{x}`, maxNative, attr: 'Esri', ...extra });
const WI_LEAF_OFF = { kind: 'export', url: 'https://dnrmaps.wi.gov/arcgis_image/rest/services/DW_Imagery/EN_Image_Basemap_Latest_Leaf_Off/ImageServer', image: true, minZoom: 12, attr: 'WI DNR, WROC / SEWRPC leaf-off imagery' };
const LABELS = esri('Reference/World_Boundaries_and_Places', 19, { opacity: 0.9 });
const ROADS = esri('Reference/World_Transportation', 19, { opacity: 0.9 });

export const BASE_LAYERS = [
  { id: 'wi-leafoff', label: 'WI leaf-off 3-inch (county flights)', note: 'Sharpest. Spring leaf-off photos from county flights (2020-2024). Shows trails, benches, cover. Wisconsin only; Esri imagery fills in when zoomed out.', kind: 'stack', layers: [esri('World_Imagery', 19), WI_LEAF_OFF] },
  { id: 'wi-leafoff-hybrid', label: 'WI leaf-off + roads & labels', kind: 'stack', layers: [esri('World_Imagery', 19), WI_LEAF_OFF, ROADS, LABELS] },
  { id: 'satellite', label: 'Imagery (Esri)', note: 'Leaf-on, worldwide.', kind: 'stack', layers: [esri('World_Imagery', 19)] },
  { id: 'imagery-hybrid', label: 'Imagery hybrid (Esri)', kind: 'stack', layers: [esri('World_Imagery', 19), ROADS, LABELS] },
  { id: 'naip', label: 'NAIP summer imagery (USDA)', note: 'Leaf-on summer photos. Good for crops and food sources.', kind: 'stack', layers: [esri('World_Imagery', 19), { kind: 'export', url: 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer', image: true, minZoom: 11, attr: 'USDA NAIP via USGS' }] },
  { id: 'imagery-topo', label: 'Imagery + contours (USGS)', kind: 'xyz', url: `${USGS}USGSImageryTopo/MapServer/tile/{z}/{y}/{x}`, maxNative: 16, attr: 'USGS The National Map' },
  { id: 'usgs-topo', label: 'USGS National Map', kind: 'xyz', url: `${USGS}USGSTopo/MapServer/tile/{z}/{y}/{x}`, maxNative: 16, attr: 'USGS The National Map' },
  { id: 'usa-topo', label: 'USA Topo Maps (classic quads)', ...esri('USA_Topo_Maps', 15) },
  { id: 'esri-topo', label: 'Topographic', ...esri('World_Topo_Map', 19) },
  { id: 'natgeo', label: 'National Geographic style', ...esri('NatGeo_World_Map', 16) },
  { id: 'terrain', label: 'Terrain with labels', kind: 'stack', layers: [esri('World_Terrain_Base', 13), esri('Reference/World_Reference_Overlay', 13)] },
  { id: 'streets', label: 'Streets', ...esri('World_Street_Map', 19) },
  { id: 'osm', label: 'OpenStreetMap', kind: 'xyz', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxNative: 19, attr: '© OpenStreetMap contributors' },
  { id: 'light-gray', label: 'Light gray canvas', kind: 'stack', layers: [esri('Canvas/World_Light_Gray_Base', 16), esri('Canvas/World_Light_Gray_Reference', 16)] },
  { id: 'dark-gray', label: 'Dark gray canvas', kind: 'stack', layers: [esri('Canvas/World_Dark_Gray_Base', 16), esri('Canvas/World_Dark_Gray_Reference', 16)] },
  { id: 'oceans', label: 'Oceans', kind: 'stack', layers: [esri('Ocean/World_Ocean_Base', 13), esri('Ocean/World_Ocean_Reference', 13)] },
];
export const DEFAULT_BASE = 'wi-leafoff';

export const OVERLAYS = [
  { id: 'parcels', label: 'Property lines & owners (WI parcels)', kind: 'parcels', default: true },
  { id: 'hillshade', label: 'Hillshade (ridges & draws)', kind: 'xyz', url: `${USGS}USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}`, maxNative: 16, opacity: 0.45, attr: 'USGS' },
  { id: 'contours', label: 'Contour lines (USGS)', kind: 'export', url: 'https://carto.nationalmap.gov/arcgis/rest/services/contours/MapServer', minZoom: 13, attr: 'USGS' },
  { id: 'labels', label: 'Roads & place names', kind: 'stack', layers: [ROADS, LABELS] },
];

// Wisconsin statewide parcel map (V12, 2026), hosted by the WI State Cartographer's Office.
export const PARCELS_URL = 'https://services3.arcgis.com/n6uYoouQZW75n5WI/ArcGIS/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer/0';

export const WINDS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// Feature types. geom: point | line | area. fields: extra per-type inputs.
// "grade" is used by the scouting step to rank funnels, stands and crossings.
export const TYPES = {
  stand:     { label: 'Tree stand',   geom: 'point', glyph: 'TS', color: '#e8590c', fields: ['bestWinds', 'timeOfDay', 'height', 'grade', 'access'] },
  blind:     { label: 'Ground blind', geom: 'point', glyph: 'GB', color: '#7f5539', fields: ['bestWinds', 'timeOfDay', 'grade', 'access'] },
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
