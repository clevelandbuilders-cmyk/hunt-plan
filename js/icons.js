// Map marker pictograms: white line drawings on a colored round badge (24x24 grid).
const S = (d, extra = '') => `<path d="${d}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>${extra}`;
const F = (d) => `<path d="${d}" fill="#fff"/>`;

export const ICONS = {
  // ladder stand: two rails, rungs, seat and rail on top
  stand: S('M8 22 10.5 7M16 22 13.5 7M8.9 17h6.2M9.7 12.5h4.6M7 7h10M8 7V3.5h8V7'),
  // hub blind: tent with a window
  blind: S('M3 20 12 4l9 16ZM9.5 13h5v3h-5Z'),
  // trail camera: body, lens, strap
  camera: S('M6 6h12a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1ZM3 10h2M19 10h2', '<circle cx="12" cy="11.5" r="3" fill="none" stroke="#fff" stroke-width="2"/><circle cx="9" cy="16.5" r="0.9" fill="#fff"/><circle cx="15" cy="16.5" r="0.9" fill="#fff"/>'),
  // scrape: licking branch over pawed ground
  scrape: S('M3 5c5 0 9 1 13 4M10 6.5 9 10M14 8l.5 3.5M4 19c2-2 4-3 8-3s6 1 8 3M8 15.5l-1 3M12 15l0 3.5M16 15.5l1 3'),
  // rub: tree trunk with scraped bark
  rub: S('M9 22V3M15 22V3M10.5 9.5l3-1.5M10.5 12.5l3-1.5M10.5 15.5l3-1.5'),
  // bed: oval of matted grass
  bed: S('M4 13c0-3.5 3.6-6 8-6s8 2.5 8 6-3.6 5-8 5-8-1.5-8-5ZM8 13c0-1.6 1.8-3 4-3s4 1.4 4 3'),
  // crossing: two paths crossing with hoofprints
  crossing: S('M4 20 20 4M4 4l16 16') + F('M5.5 9.5a1.2 1.8 0 1 0 0.1 0ZM8.2 9.5a1.2 1.8 0 1 0 0.1 0Z'),
  // food: acorn
  food: S('M5 10c0-3 3-5 7-5s7 2 7 5ZM6.5 10c0 5 2.5 9 5.5 10.5 3-1.5 5.5-5.5 5.5-10.5M12 5V2.5'),
  // water: drop
  water: S('M12 3c3.5 4.5 6 8 6 11a6 6 0 0 1-12 0c0-3 2.5-6.5 6-11Z'),
  // sighting: antlers
  sighting: S('M12 21v-7M12 14c-3-1-5-4-5-9M7 9 4.5 7.5M8 6.5 6.5 3.5M12 14c3-1 5-4 5-9M17 9l2.5-1.5M16 6.5l1.5-3'),
  // parking / access: P
  access: S('M8 20V4h5a4 4 0 0 1 0 8H8'),
  // waypoint: flag
  waypoint: S('M6 21V3M6 4h11l-2.5 4L17 12H6'),
};

// List badges for lines and areas.
const LINE = S('M3 17c3-6 6 2 9-4s6-4 9-8');
const AREA = S('M5 6l8-2 6 5-2 10-11 1Z');

export function iconSvg(type, size = 18, geom = 'point') {
  const body = ICONS[type] || (geom === 'line' ? LINE : geom === 'area' ? AREA : ICONS.waypoint);
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
}
