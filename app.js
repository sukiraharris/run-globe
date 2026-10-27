/* Run Globe — draws every recorded route on an interactive globe.
   Data comes from data/activities.json (built by scripts/fetch-strava.mjs). */

const SPORTS = {
  Run:   { label: 'Runs',   color: '#FFB547' },
  Ride:  { label: 'Rides',  color: '#5BD1E8' },
  Hike:  { label: 'Hikes & walks', color: '#A8C97F' },
  Swim:  { label: 'Swims',  color: '#B9A8FF' },
  Other: { label: 'Other',  color: '#F28FB0' },
};
const WORLD_VIEW = { lat: 38, lng: -40, altitude: innerWidth < 760 ? 3.6 : 2.3 };
const LABEL_ALT_HIDE = 0.12;   // hide place pins once zoomed into a place
// Street maps shown when zoomed into a place.
// Stadia "Alidade Smooth Dark" has place and street names; it needs this site's domain
// added to a free Stadia account (see README). Until then we fall back to Esri's
// keyless dark gray map, which has no labels.
const TILES = {
  stadia: {
    url: (x, y, l) => `https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/${l}/${x}/${y}@2x.png`,
    maxLevel: 19,
    credit: '© <a href="https://stadiamaps.com/">Stadia Maps</a> © <a href="https://openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  esri: {
    url: (x, y, l) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${l}/${y}/${x}`,
    maxLevel: 16,
    credit: 'Map tiles © <a href="https://www.esri.com">Esri</a>, HERE, Garmin, © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
};
let tiles = TILES.esri;
// Use Stadia if it answers for this site; otherwise stay on Esri.
fetch(TILES.stadia.url(0, 0, 0), { mode: 'cors' })
  .then((r) => { if (r.ok) tiles = TILES.stadia; })
  .catch(() => {})
  .finally(() => {
    document.body.dataset.tiles = tiles === TILES.stadia ? 'stadia' : 'esri';
    $('credit').innerHTML = tiles.credit;
    if (state.closeUp && globe) globe.globeTileEngineMaxLevel(tiles.maxLevel).globeTileEngineUrl(tiles.url);
  });
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortName = (name) => name.split(',')[0].split(' / ').pop().trim();
const fmtKm = (km) => km >= 100 ? Math.round(km).toLocaleString() : km.toFixed(1);
const fmtDate = (d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-GB', opts);
const fmtTime = (s) => {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`;
};

const params = new URLSearchParams(location.search);
if (params.has('embed')) document.body.classList.add('embed');

const state = {
  data: null,
  enabled: new Set(Object.keys(SPORTS)),
  cutoff: null,          // ISO date; activities after this are hidden
  focus: null,           // place id or null
  playing: false,
  mode: params.get('mode') === 'heat' ? 'heat' : 'sport',   // colour routes by sport or by repeats
};

// "Repeats" colour ramp: how many different activities covered a stretch
const HEAT = [
  { min: 1,  label: '1',   color: 'rgba(80, 112, 200, 0.75)', width: 1.2 },
  { min: 2,  label: '2',   color: '#6d74e8', width: 1.4 },
  { min: 4,  label: '4',   color: '#a466ea', width: 1.6 },
  { min: 8,  label: '8',   color: '#e45f9f', width: 1.9 },
  { min: 16, label: '16',  color: '#ff9b52', width: 2.2 },
  { min: 32, label: '32+', color: '#ffe6a8', width: 2.6 },
];
const heatBucket = (n) => { let b = 0; for (let i = 0; i < HEAT.length; i++) if (n >= HEAT[i].min) b = i; return b; };

let globe;

async function init() {
  const data = await fetch('data/activities.json', { cache: 'no-cache' }).then((r) => r.json());
  data.byPlace = Object.fromEntries(data.places.map((p) => [p.id, p]));
  state.data = data;
  state.cutoff = data.activities.at(-1)?.date;
  // only offer toggles for sports that exist in the data
  const present = new Set(data.activities.map((a) => a.sport));
  for (const k of Object.keys(SPORTS)) if (!present.has(k)) delete SPORTS[k];

  if (data.sample) {
    $('note').hidden = false;
    $('note').textContent = 'Preview: a handful of recent routes. The full history fills in once the Strava sync runs.';
  }

  buildGlobe();
  buildSportToggles();
  buildModeToggle();
  buildTimeline();
  render();
  openPlaceFromUrl();
}

/* ---------------- Globe ---------------- */

function buildGlobe() {
  globe = new Globe($('globe'), { rendererConfig: { antialias: true, alpha: true } })
    .backgroundColor('rgba(0,0,0,0)')
    .showAtmosphere(true)
    .atmosphereColor('#6f94d6')
    .atmosphereAltitude(0.17)
    .globeImageUrl(null)
    // routes
    .pathPoints('pts')
    .pathPointLat((p) => p[0])
    .pathPointLng((p) => p[1])
    .pathPointAlt(0.0012)
    .pathColor((s) => (s.bucket != null ? HEAT[s.bucket].color : SPORTS[s.act.sport].color))
    .pathStroke((s) => (s.bucket != null ? HEAT[s.bucket].width : 1.6) * (state.closeUp ? 1.35 : 1))
    .pathTransitionDuration(0)
    .pathLabel((s) => (s.bucket != null ? heatTipHtml(s) : tipHtml(s.act)))
    .onPathClick((s) => flyTo(s.act.place))
    // place spikes (world view)
    .pointLat('lat').pointLng('lng')
    .pointAltitude((p) => 0.01 + 0.09 * Math.sqrt(p.km / state.maxPlaceKm))
    .pointRadius(0.16)
    .pointColor(() => 'rgba(255, 222, 170, 0.9)')
    .pointsMerge(false)
    .pointsTransitionDuration(reduceMotion ? 0 : 600)
    .pointLabel((p) => `<div class="tip"><b>${esc(p.name)}</b><span>${fmtKm(p.km)} km · ${p.count} activities</span></div>`)
    .onPointClick((p) => flyTo(p.id))
    // place names
    .htmlLat('lat').htmlLng('lng')
    .htmlAltitude((p) => 0.015 + 0.09 * Math.sqrt(p.km / state.maxPlaceKm))
    .htmlElement((p) => {
      const el = document.createElement('div');
      el.className = 'pin';
      el.innerHTML = `${esc(shortName(p.name))}<small>${fmtKm(p.km)} km</small>`;
      el.addEventListener('click', () => flyTo(p.id));
      return el;
    })
    .htmlTransitionDuration(0);

  if (typeof globe.htmlElementVisibilityModifier === 'function') {
    globe.htmlElementVisibilityModifier((el, visible) => {
      el.style.opacity = visible && !state.closeUp ? 1 : 0;
      el.style.pointerEvents = visible && !state.closeUp ? 'auto' : 'none';
    });
  }

  // Quiet ocean, dotted land
  const mat = globe.globeMaterial();
  mat.color.set('#0F1E36');
  mat.emissive?.set('#0a1529');
  mat.shininess = 4;

  fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
    .then((r) => r.json())
    .then((topo) => {
      const land = topojson.feature(topo, topo.objects.countries).features
        .filter((f) => f.properties.name !== 'Antarctica');
      state.land = land;
      globe.hexPolygonsData(state.closeUp ? [] : land)
        .hexPolygonResolution(3)
        .hexPolygonMargin(0.42)
        .hexPolygonUseDots?.(true);
      globe.hexPolygonColor(() => '#33476A').hexPolygonAltitude(0.002);
    })
    .catch(() => {});

  const controls = globe.controls();
  controls.minDistance = 100.35;
  controls.zoomSpeed = 1.4;
  controls.autoRotate = !reduceMotion && !params.has('still');
  controls.autoRotateSpeed = 0.35;
  globe.renderer().domElement.addEventListener('pointerdown', () => { controls.autoRotate = false; });

  globe.onZoom?.(({ altitude }) => {
    const close = altitude < LABEL_ALT_HIDE;
    if (close !== state.closeUp) {
      state.closeUp = close;
      globe.pointsData(close ? [] : state.visiblePlaces || []);
      // swap the dotted world for real street tiles when zoomed into a place
      globe.hexPolygonsData(close ? [] : state.land || []);
      globe.globeTileEngineMaxLevel(tiles.maxLevel);
      globe.globeTileEngineUrl(close ? tiles.url : null);
      $('credit').hidden = !close;
      document.body.classList.toggle('close-up', close);
      // fat lines get thinner relative to the view when zoomed in; keep them crisp
      globe.pathStroke(globe.pathStroke());   // re-apply widths for the new zoom
    }
    // keep rotation gentle when close
    controls.rotateSpeed = Math.max(0.05, Math.min(1, altitude * 0.6));
  });

  globe.pointOfView(WORLD_VIEW, 0);
  window.addEventListener('resize', () => globe.width(innerWidth).height(innerHeight));
}

// ?place=Boston opens zoomed into that place
function openPlaceFromUrl() {
  const q = params.get('place');
  if (!q) return;
  const match = state.data.places.find((p) => p.name.toLowerCase().startsWith(q.toLowerCase()));
  if (match) setTimeout(() => flyTo(match.id), 400);
}

function tipHtml(a) {
  const place = shortName(state.data.byPlace[a.place]?.name || '');
  return `<div class="tip"><b>${esc(a.name)}</b><span>${fmtDate(a.date)} · ${esc(place)}<br>${fmtKm(a.km)} km · ${fmtTime(a.sec)}${a.elev ? ` · ${a.elev} m up` : ''}</span></div>`;
}

function flyTo(placeId) {
  const controls = globe.controls();
  controls.autoRotate = false;
  if (!placeId) {
    state.focus = null;
    globe.pointOfView(WORLD_VIEW, reduceMotion ? 0 : 1600);
  } else {
    const p = state.data.byPlace[placeId];
    state.focus = placeId;
    globe.pointOfView({ ...(p.center || p), altitude: p.zoom }, reduceMotion ? 0 : 2000);
  }
  markCurrentPlace();
}

/* ---------------- Controls ---------------- */

function buildSportToggles() {
  const nav = $('sports');
  for (const [key, s] of Object.entries(SPORTS)) {
    const b = document.createElement('button');
    b.className = 'sport';
    b.type = 'button';
    b.style.setProperty('--c', s.color);
    b.setAttribute('aria-pressed', 'true');
    b.innerHTML = `<span class="swatch"></span>${s.label}`;
    b.addEventListener('click', () => {
      const on = !state.enabled.has(key);
      on ? state.enabled.add(key) : state.enabled.delete(key);
      b.setAttribute('aria-pressed', String(on));
      render();
    });
    nav.append(b);
  }
  $('world').addEventListener('click', () => flyTo(null));
}

function buildTimeline() {
  const acts = state.data.activities;
  const t0 = Date.parse(acts[0].date), t1 = Date.parse(acts.at(-1).date);
  const span = Math.max(1, t1 - t0);
  const scrub = $('scrub');
  const days = Math.round(span / 864e5);
  scrub.max = String(days);
  scrub.value = String(days);
  state.dayToDate = (d) => new Date(t0 + d * 864e5).toISOString().slice(0, 10);
  state.dateToX = (iso) => (Date.parse(iso) - t0) / span;

  scrub.addEventListener('input', () => {
    stopPlaying();
    state.cutoff = state.dayToDate(Number(scrub.value));
    render();
  });
  $('play').addEventListener('click', () => (state.playing ? stopPlaying() : startPlaying()));
  new ResizeObserver(drawBarcode).observe($('barcode'));
}

function drawBarcode() {
  const canvas = $('barcode');
  const dpr = devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  // baseline
  ctx.fillStyle = 'rgba(232,237,245,0.14)';
  ctx.fillRect(0, h - 1, w, 1);
  const maxKm = Math.max(...state.data.activities.map((a) => a.km));
  for (const a of state.data.activities) {
    const x = Math.round(state.dateToX(a.date) * (w - 2)) + 0.5;
    const bar = 6 + (h - 10) * Math.sqrt(a.km / maxKm);
    const shown = state.enabled.has(a.sport) && a.date <= state.cutoff;
    ctx.globalAlpha = shown ? 0.95 : 0.18;
    ctx.fillStyle = SPORTS[a.sport]?.color || '#fff';
    ctx.fillRect(x, h - 1 - bar, 1.5, bar);
  }
  ctx.globalAlpha = 1;
}

let raf;
function startPlaying() {
  const scrub = $('scrub');
  state.playing = true;
  $('playIcon').setAttribute('d', 'M4 2.5h3v11H4zM9 2.5h3v11H9z');
  $('play').setAttribute('aria-label', 'Pause timeline');
  if (Number(scrub.value) >= Number(scrub.max)) scrub.value = '0';
  const duration = 9000, startVal = Number(scrub.value), max = Number(scrub.max);
  const t0 = performance.now() - (startVal / max) * duration;
  const step = (now) => {
    const v = Math.min(max, Math.round(((now - t0) / duration) * max));
    if (String(v) !== scrub.value) {
      scrub.value = String(v);
      state.cutoff = state.dayToDate(v);
      render();
    }
    if (v < max && state.playing) raf = requestAnimationFrame(step);
    else stopPlaying();
  };
  raf = requestAnimationFrame(step);
}
function stopPlaying() {
  state.playing = false;
  cancelAnimationFrame(raf);
  $('playIcon').setAttribute('d', 'M4 2.5v11l9-5.5z');
  $('play').setAttribute('aria-label', 'Play timeline');
}

/* ---------------- Repeats heatmap ---------------- */

// For every route point, list which activities passed within ~35 m of it.
// Built once (a few hundred ms), then each redraw just counts the visible ones.
let heatIndex = null;
function buildHeatIndex() {
  const CELL = 0.0003;                       // grid cell ≈ 33 m north–south
  const acts = state.data.activities;
  const colOf = (la, ln) => Math.round(ln / (CELL / Math.cos(la * Math.PI / 180)));
  const grid = new Map();
  acts.forEach((a, i) => {
    for (const seg of a.segments) for (let k = 0; k < seg.length; k++) {
      const p = seg[k], q = seg[k + 1] || p;
      const dLat = q[0] - p[0], dLng = q[1] - p[1];
      const metres = Math.hypot(dLat * 111000, dLng * 111000 * Math.cos(p[0] * Math.PI / 180));
      const steps = Math.max(1, Math.ceil(metres / 15));   // fill gaps between sparse points
      for (let t = 0; t < steps; t++) {
        const la = p[0] + (dLat * t) / steps, ln = p[1] + (dLng * t) / steps;
        const key = Math.round(la / CELL) + ',' + colOf(la, ln);
        let set = grid.get(key);
        if (!set) grid.set(key, (set = new Set()));
        set.add(i);
      }
    }
  });
  // per activity → per segment → per point: activity ids nearby (3×3 cells)
  heatIndex = acts.map((a) => a.segments.map((seg) => seg.map(([la, ln]) => {
    const r = Math.round(la / CELL), c = colOf(la, ln), near = new Set();
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const cell = grid.get(r + dr + ',' + (c + dc));
      if (cell) for (const id of cell) near.add(id);
    }
    return Int32Array.from(near);
  })));
}

// Split visible routes into runs of points that share a colour bucket.
function heatPaths(visibleIdx) {
  if (!heatIndex) buildHeatIndex();
  const acts = state.data.activities;
  const on = new Uint8Array(acts.length);
  for (const i of visibleIdx) on[i] = 1;
  const paths = [];
  for (const i of visibleIdx) {
    const act = acts[i];
    act.segments.forEach((seg, si) => {
      const lists = heatIndex[i][si];
      let chunk = null;
      for (let k = 0; k < seg.length; k++) {
        let n = 0;
        for (const id of lists[k]) n += on[id];
        const b = heatBucket(n);
        if (!chunk || chunk.bucket !== b) {
          if (chunk) { chunk.pts.push(seg[k]); if (chunk.pts.length > 1) paths.push(chunk); }
          chunk = { act, bucket: b, count: n, pts: [seg[k]] };
        } else {
          chunk.pts.push(seg[k]);
          chunk.count = Math.max(chunk.count, n);
        }
      }
      if (chunk && chunk.pts.length > 1) paths.push(chunk);
    });
  }
  // draw the hottest stretches last so they sit on top
  return paths.sort((a, b) => a.bucket - b.bucket);
}

function heatTipHtml(s) {
  const title = s.count === 1 ? 'Covered once' : `Covered ${s.count} times`;
  return `<div class="tip"><b>${title}</b><span>One of them: ${esc(s.act.name)}, ${fmtDate(s.act.date)}</span></div>`;
}

function buildModeToggle() {
  const wrap = document.createElement('div');
  wrap.className = 'mode';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Colour routes by');
  for (const [key, label] of [['sport', 'By sport'], ['heat', 'Repeats']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.mode = key;
    b.textContent = label;
    b.setAttribute('aria-pressed', String(state.mode === key));
    b.addEventListener('click', () => {
      state.mode = key;
      for (const x of wrap.children) x.setAttribute('aria-pressed', String(x.dataset.mode === key));
      render();
    });
    wrap.append(b);
  }
  $('sports').prepend(wrap);

  const legend = $('legend');
  legend.innerHTML = `<span class="legend-title">Times covered</span>` +
    HEAT.map((h) => `<span class="legend-step"><i style="background:${h.color}"></i>${h.label}</span>`).join('');
}

/* ---------------- Render ---------------- */

function render() {
  const { data, enabled, cutoff } = state;
  const visible = data.activities.filter((a) => enabled.has(a.sport) && a.date <= cutoff);

  // routes: one path per privacy-trimmed segment, or per colour run in Repeats mode
  const heat = state.mode === 'heat';
  document.body.classList.toggle('heat', heat);
  $('legend').hidden = !heat;
  if (heat) {
    const idx = [];
    data.activities.forEach((a, i) => { if (enabled.has(a.sport) && a.date <= cutoff) idx.push(i); });
    globe.pathsData(heatPaths(idx));
  } else {
    globe.pathsData(visible.flatMap((act) => act.segments.map((pts) => ({ act, pts }))));
  }

  // places with stats for what's visible
  const stats = {};
  for (const a of visible) {
    const s = (stats[a.place] ||= { km: 0, count: 0, bySport: {}, minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 });
    s.km += a.km; s.count++;
    s.bySport[a.sport] = (s.bySport[a.sport] || 0) + a.km;
    for (const seg of a.segments) for (const [la, ln] of seg) {
      s.minLat = Math.min(s.minLat, la); s.maxLat = Math.max(s.maxLat, la);
      s.minLng = Math.min(s.minLng, ln); s.maxLng = Math.max(s.maxLng, ln);
    }
  }
  const places = data.places
    .filter((p) => stats[p.id])
    .map((p) => {
      const s = stats[p.id];
      const spanDeg = Math.max(s.maxLat - s.minLat, (s.maxLng - s.minLng) * Math.cos(p.lat * Math.PI / 180));
      // camera altitude (in globe radii) that frames this place's routes
      const zoom = Math.min(0.11, Math.max(0.004, 0.003 + spanDeg * 0.03));
      const center = { lat: (s.minLat + s.maxLat) / 2, lng: (s.minLng + s.maxLng) / 2 };
      Object.assign(data.byPlace[p.id], { zoom, center });
      return { ...p, ...s, zoom };
    })
    .sort((a, b) => b.km - a.km);
  state.visiblePlaces = places;
  state.maxPlaceKm = Math.max(1, ...places.map((p) => p.km));
  globe.pointsData(state.closeUp ? [] : places);
  globe.htmlElementsData(places);

  renderSummary(visible, places);
  renderPlaceList(places);
  drawBarcode();
  $('dateLabel').textContent = cutoff === data.activities.at(-1).date ? 'Today' : fmtDate(cutoff);
}

function renderSummary(visible, places) {
  const km = visible.reduce((s, a) => s + a.km, 0);
  const countries = new Set(places.map((p) => p.name.split(',').at(-1).trim())).size;
  const since = visible[0] ? fmtDate(visible[0].date, { month: 'long', year: 'numeric' }) : '';
  $('summary').innerHTML = visible.length
    ? `<strong>${fmtKm(km)} km</strong> over <strong>${visible.length}</strong> ${visible.length === 1 ? 'activity' : 'activities'}, in ${places.length} ${places.length === 1 ? 'place' : 'places'} across ${countries} ${countries === 1 ? 'country' : 'countries'} since ${since}. Drag to spin, click a place to fly in.`
    : 'Nothing to show for this selection.';
}

function renderPlaceList(places) {
  const ol = $('places');
  ol.innerHTML = '';
  for (const p of places) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'place';
    b.type = 'button';
    b.dataset.id = p.id;
    const mix = Object.entries(p.bySport)
      .sort((x, y) => y[1] - x[1])
      .map(([sp, km]) => `<i style="flex:${km};background:${SPORTS[sp].color}"></i>`)
      .join('');
    b.innerHTML = `<span class="name">${esc(shortName(p.name))}</span>
      <span class="meta">${fmtKm(p.km)} km · ${p.count} ${p.count === 1 ? 'activity' : 'activities'}</span>
      <span class="mix" aria-hidden="true">${mix}</span>`;
    b.addEventListener('click', () => flyTo(p.id));
    li.append(b);
    ol.append(li);
  }
  markCurrentPlace();
}

function markCurrentPlace() {
  for (const b of document.querySelectorAll('.place')) {
    b.setAttribute('aria-current', String(b.dataset.id === state.focus));
  }
  $('world').setAttribute('aria-current', String(!state.focus));
}

init().catch((err) => {
  console.error(err);
  $('summary').textContent = 'Routes could not load. Check that data/activities.json exists in the repo.';
});
