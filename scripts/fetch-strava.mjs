#!/usr/bin/env node
// Pulls your full Strava history and writes data/activities.json for the globe.
//
// Needs three environment variables (see README):
//   STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN
// Optional:
//   PRIVACY_RADIUS_M   metres hidden around every start/finish (default 500)
//   INCLUDE_PRIVATE=1  also include activities marked "Only you" (default: skipped)
//
// Run locally:  node scripts/fetch-strava.mjs
// Runs automatically every day via .github/workflows/update-data.yml

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDataset } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'activities.json');
const CACHE = path.join(ROOT, 'data', 'places-cache.json');
const API = process.env.STRAVA_API_BASE || 'https://www.strava.com';

const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN } = process.env;
if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET || !STRAVA_REFRESH_TOKEN) {
  console.error('Missing STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET or STRAVA_REFRESH_TOKEN. See README → "Connect Strava".');
  process.exit(1);
}

async function accessToken() {
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      refresh_token: STRAVA_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Strava token refresh failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

async function allActivities(token) {
  const out = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${API}/api/v3/athlete/activities?per_page=200&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) throw new Error('Strava rate limit hit — try again in 15 minutes.');
    if (!res.ok) throw new Error(`Strava activities request failed (${res.status}): ${await res.text()}`);
    const batch = await res.json();
    out.push(...batch);
    console.log(`page ${page}: ${batch.length} activities`);
    if (batch.length < 200) break;
  }
  return out;
}

const token = await accessToken();
const raw = await allActivities(token);
const includePrivate = process.env.INCLUDE_PRIVATE === '1';

const usable = raw
  .filter((a) => includePrivate || (!a.private && a.visibility !== 'only_me'))
  .map((a) => ({
    id: a.id,
    name: a.name,
    sport_type: a.sport_type || a.type,
    date: a.start_date_local,
    distance_m: a.distance,
    moving_time_s: a.moving_time,
    elevation_m: a.total_elevation_gain,
    polyline: a.map?.summary_polyline || '',
  }));

const geocodeCache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const dataset = await buildDataset(usable, { geocodeCache });

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(dataset));
fs.writeFileSync(CACHE, JSON.stringify(geocodeCache, null, 2));
console.log(`Wrote ${dataset.activities.length} routes in ${dataset.places.length} places → data/activities.json`);
