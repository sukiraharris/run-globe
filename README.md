# Run Globe

Every run, ride, hike and walk I've recorded on Strava, drawn on a 3D globe you can spin, zoom and replay.

**Live:** https://sukiraharris.github.io/run-globe/

- Zoomed out, each place I've trained shows up as a glowing marker with its total distance.
- Click a place (or a route) to fly in. The dotted world turns into a street map, and every route is drawn in its sport's color.
- The barcode along the bottom has one tick per activity. Drag it, or press play, to watch the map fill in over time.
- The data refreshes itself every day through a GitHub Action, with no server and no API keys in the page.

Built with [globe.gl](https://github.com/vasturiano/globe.gl) / three.js, vanilla JS, and the Strava API.

---

## Setup

### 1. Put it on GitHub Pages

```bash
cd run-globe
git init && git add . && git commit -m "Run globe"
gh repo create run-globe --public --source=. --push
```

Then go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, and select `main` / `(root)`. The site goes live at `https://<username>.github.io/run-globe/`.

It already works at this point, using a small preview set of routes.

### 2. Connect Strava (one time, about 5 minutes)

1. Go to <https://www.strava.com/settings/api> and create an app. Any name and website work. Set **Authorization Callback Domain** to `localhost`.
2. Note the **Client ID** and **Client Secret**.
3. Get a refresh token:
   ```bash
   node scripts/get-token.mjs <CLIENT_ID>
   # open the link, click Authorize, copy the code= value from the address bar
   node scripts/get-token.mjs <CLIENT_ID> <CLIENT_SECRET> <CODE>
   ```
4. In the repo, go to **Settings → Secrets and variables → Actions** and add three secrets: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`.
5. Go to **Actions → Update routes from Strava → Run workflow**. A minute later your whole history is on the globe. After that it updates daily.

To build the data on your own machine instead:

```bash
STRAVA_CLIENT_ID=… STRAVA_CLIENT_SECRET=… STRAVA_REFRESH_TOKEN=… node scripts/fetch-strava.mjs
```

### 3. Street names on the zoomed-in map (optional, free)

Zoomed-in views use [Stadia Maps](https://stadiamaps.com/) "Alidade Smooth Dark", which shows town and street names, once this site's domain is registered with them. Until then the site falls back to Esri's dark gray map, which has no labels.

1. Create a free account at <https://client.stadiamaps.com/signup/>. No card is needed, and the free plan covers non-commercial sites.
2. In the dashboard, go to **Manage Properties → Authentication Configuration** and add the domain `sukiraharris.github.io`.

No code change or API key is needed. Refresh the site and the labelled map appears.

## Privacy

This site is public, so the data is cleaned before it's published:

- **Start and finish are hidden.** Every point within 500 m of where an activity starts or ends is removed, so the map never shows where you leave from. To change the distance, set a repository variable `PRIVACY_RADIUS_M` (for example `800`).
- **"Only you" activities are skipped.** Set `INCLUDE_PRIVATE=1` if you want them anyway.
- **Only route shape and summary stats are published:** name, date, distance, time and elevation. Heart rate, descriptions and photos are never fetched.
- Activities without GPS (treadmill, pool swims, gym) are left out.

## Add it to the personal website

Embed the compact version anywhere:

```html
<iframe
  src="https://sukiraharris.github.io/run-globe/?embed"
  title="Every place I've run"
  style="width:100%; height:560px; border:0; border-radius:12px; background:#081120"
  loading="lazy"></iframe>
```

URL options, which can be combined:

| Option | What it does |
| --- | --- |
| `?embed` | Smaller title, hides the place list (best inside an iframe) |
| `?place=Boston` | Opens zoomed into that place |
| `?still` | Turns off the slow auto-spin |

## Files

```
index.html, style.css, app.js      the site
data/activities.json               routes the site loads (written by the Action)
data/places-cache.json             cached place names (OpenStreetMap reverse geocoding)
scripts/fetch-strava.mjs           pulls Strava → cleans → writes data
scripts/lib.mjs                    polyline decoding, privacy trimming, place clustering
scripts/get-token.mjs              one-time Strava authorization helper
.github/workflows/update-data.yml  daily refresh
```

Street map tiles © [Stadia Maps](https://stadiamaps.com/) / [OpenMapTiles](https://openmaptiles.org/), or © [Esri](https://www.esri.com) (World Dark Gray Canvas) as a fallback. Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. Country shapes from [Natural Earth](https://www.naturalearthdata.com/) via world-atlas.
