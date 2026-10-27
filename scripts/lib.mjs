// Shared data-processing helpers for the run globe.
// Used by fetch-strava.mjs (GitHub Action / local) to turn raw Strava
// activities into the privacy-safe data/activities.json the site loads.

export const PRIVACY_RADIUS_M = Number(process.env.PRIVACY_RADIUS_M || 500);
export const CLUSTER_RADIUS_KM = 30;

// Google encoded polyline -> [[lat, lng], ...]
export function decodePolyline(str, precision = 5) {
  const factor = 10 ** precision;
  const coords = [];
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0, shift = 0, byte;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta; else lng += delta;
    }
    coords.push([lat / factor, lng / factor]);
  }
  return coords;
}

export function haversineM([lat1, lng1], [lat2, lng2]) {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad, dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Remove every point within `radius` metres of the route's start or end,
// so a public map never shows where you leave from (usually home).
// The route is split into separate segments wherever points are removed.
export function privacyTrim(coords, radius = PRIVACY_RADIUS_M) {
  if (coords.length < 2 || radius <= 0) return coords.length > 1 ? [coords] : [];
  const start = coords[0], end = coords[coords.length - 1];
  const segments = [];
  let current = [];
  for (const p of coords) {
    const hidden = haversineM(p, start) < radius || haversineM(p, end) < radius;
    if (hidden) {
      if (current.length > 1) segments.push(current);
      current = [];
    } else {
      current.push(p);
    }
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

export function sportGroup(type = '') {
  if (/Run/i.test(type)) return 'Run';
  if (/Ride|Bike|Velomobile|Handcycle/i.test(type)) return 'Ride';
  if (/Swim/i.test(type)) return 'Swim';
  if (/Hike|Walk/i.test(type)) return 'Hike';
  return 'Other';
}

const round5 = (n) => Math.round(n * 1e5) / 1e5;

// Turn one raw activity into the public record (or null if it has no usable GPS).
export function toPublicActivity(a) {
  if (!a.polyline) return null;
  const coords = decodePolyline(a.polyline);
  const segments = privacyTrim(coords)
    .map((seg) => seg.map(([la, ln]) => [round5(la), round5(ln)]));
  if (!segments.length) return null;
  const all = segments.flat();
  const centroid = [
    all.reduce((s, p) => s + p[0], 0) / all.length,
    all.reduce((s, p) => s + p[1], 0) / all.length,
  ];
  return {
    id: String(a.id),
    name: a.name,
    sport: sportGroup(a.sport_type),
    type: a.sport_type,
    date: a.date.slice(0, 10),
    km: Math.round((a.distance_m / 1000) * 100) / 100,
    sec: a.moving_time_s,
    elev: Math.round(a.elevation_m || 0),
    centroid: centroid.map(round5),
    segments,
  };
}

// Greedy geographic clustering of activities into "places".
export function clusterPlaces(acts, radiusKm = CLUSTER_RADIUS_KM) {
  const places = [];
  for (const a of acts) {
    let best = null, bestD = Infinity;
    for (const pl of places) {
      const d = haversineM(a.centroid, [pl.lat, pl.lng]) / 1000;
      if (d < radiusKm && d < bestD) { best = pl; bestD = d; }
    }
    if (!best) {
      best = { lat: a.centroid[0], lng: a.centroid[1], members: [] };
      places.push(best);
    }
    best.members.push(a);
    best.lat = best.members.reduce((s, m) => s + m.centroid[0], 0) / best.members.length;
    best.lng = best.members.reduce((s, m) => s + m.centroid[1], 0) / best.members.length;
  }
  return places.map((pl, i) => ({
    id: `p${i}`,
    lat: round5(pl.lat),
    lng: round5(pl.lng),
    members: pl.members,
  }));
}

// Reverse-geocode a place name via OpenStreetMap Nominatim (1 req/sec, cached).
export async function nameForPlace(lat, lng, cache) {
  const key = `${lat.toFixed(1)},${lng.toFixed(1)}`;
  if (cache[key]) return cache[key];
  try {
    await new Promise((r) => setTimeout(r, 1100));
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'run-globe (github pages personal project)' } });
    const j = await res.json();
    const ad = j.address || {};
    const local = ad.city || ad.town || ad.village || ad.municipality || ad.county || ad.state || 'Somewhere';
    const name = ad.country ? `${local}, ${ad.country}` : local;
    cache[key] = name;
    return name;
  } catch {
    return `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
  }
}

// Assemble the final JSON the site reads.
export async function buildDataset(rawActivities, { geocodeCache = {}, names = {} } = {}) {
  const acts = rawActivities
    .map(toPublicActivity)
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
  const clusters = clusterPlaces(acts);
  const places = [];
  for (const c of clusters) {
    const fromMember = c.members.find((m) => names[m.id])?.id;
    const name = fromMember ? names[fromMember] : await nameForPlace(c.lat, c.lng, geocodeCache);
    for (const m of c.members) { m.place = c.id; delete m.centroid; }
    places.push({ id: c.id, name, lat: c.lat, lng: c.lng });
  }
  return { generated: new Date().toISOString(), privacyRadiusM: PRIVACY_RADIUS_M, places, activities: acts };
}
