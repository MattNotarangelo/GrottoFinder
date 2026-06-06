# Grotto Finder

A fast, static web map of **NSS grottos** — local caving clubs affiliated with
the [National Speleological Society](https://caves.org). A visitor can instantly
see which grottos are nearest to them. Deployed on Cloudflare Pages; the dataset
stays in sync with the official NSS list with no manual data entry for routine
updates.

## Privacy & scope (read first)

Two firm lines, enforced in code and tests:

1. **This maps grottos (clubs), not caves.** It never collects, stores, or
   displays cave entrance locations.
2. **Town-level only.** Many listed addresses are individual members' homes. The
   parser extracts only the **town + state** and geocodes to the **town
   centroid** — never a street address. "Nearest grotto" only needs town-level
   precision, and pinning a volunteer's house is unacceptable.

The data model has no field for street address, member name, or phone number,
and `tests/town.test.ts` asserts that no extracted town contains a street
fragment.

---

## Data source: which one, and why

Everything comes from the **current caves.org site**, in two steps. We chose
this by inspecting the **actual markup, REST API, and network traffic** (not
assumptions):

1. **The roster** — `caves.org/wp-json/wp/v2/grottos` (the WordPress REST API
   behind the live "find a grotto" search). This is the authoritative, current
   list of active grottos (~236 records) with a clean `state` taxonomy. It
   decides **which** grottos exist. (It also includes ~30 non-grotto entities —
   cave surveys, NSS regions, sections — which carry no state and no town, so
   they never get coordinates and naturally stay off the map.)
2. **Each grotto's page** — `caves.org/grotto/<slug>/`. Every page has a
   "Contact Information" block with a `Town, ST ZIP`, and links to the club's
   own website. We scrape each page for the **town** and **website**.

> Dead ends, for the record: the `caves.org/find-a-grotto/` *page* renders zero
> listings in static HTML (they load client-side); the `legacy.caves.org` I/O
> list is structured but lags the current site (it still listed defunct grottos
> like *Persona Non Grotto*); and the API records themselves expose no
> structured town. Reading the per-grotto pages gives one current source for
> everything, with no name-matching between sources.

### Parsing the grotto pages

`scripts/src/pipeline/grottoPage.ts` fetches each grotto's page and extracts:

- **Town** (via `scripts/src/pipeline/town.ts`) — the `Town, ST ZIP` from the
  contact block. It handles every real-world format variant (`City, ST ZIP`,
  `City ST ZIP`, `City, ST, ZIP`, `Street, City ST ZIP`, lowercase states).
- **Website** — the club's own site, filtering out NSS's site-wide social
  accounts (twitter/NSScaves, facebook/NationalSpeleologicalSociety, …) and
  WordPress boilerplate. Falls back to the grotto's caves.org page when the club
  lists no external site.

**PRIVACY (firm constraint):** those contact blocks are usually a **member's
home address** (e.g. `Ethan Perrine, 14045 North Green Hills Loop, Austin, TX`).
We extract **only the town** — the extractor pulls the city out of a
street-bearing line and **never emits a street fragment** (`14045 North Green
Hills Loop, Austin, TX` → `Austin`; `St. Louis` is preserved, not mistaken for a
street). Street, name, and phone are discarded and never stored. `town.test.ts`
asserts this.

Of ~236 roster entries, ~30 are non-local entities and a handful of real grottos
list no address; the rest yield a clean US town, so **~200 active grottos** are
placed on the map. Grottos with no parseable town get one via
`data/overrides.json`.

### Geocoding: why Nominatim, not the US Census Geocoder

The brief suggested the US Census Geocoder. We tested it: its `/locations`
endpoint **only matches full street addresses** and returns **zero results** for
town-only inputs (`"Huntsville, AL"` → 0 matches, `"Birmingham, AL"` → 0). Since
we geocode **town centroids only** (never a street), it is the wrong tool.

We use **[Nominatim](https://nominatim.openstreetmap.org/) (OpenStreetMap)**,
which returns a municipality's centroid for `"Town, ST, USA"` — free, no API key,
and exactly the right granularity. We are good citizens of the free service:

- a descriptive `User-Agent`,
- at most **one request per second**, and
- **every result cached** in `data/geocode-cache.json`, keyed by input string,
  so a re-scrape only geocodes genuinely new towns.

---

## Repository layout

```
data/
  roster.json          # raw API roster: active grottos + states + link (regenerated)
  scraped.json         # per-grotto town + website scraped from pages (regenerated)
  geocode-cache.json   # town,ST -> lat,lng cache (committed; grows over time)
  overrides.json       # hand-maintained corrections; ALWAYS win
public/
  grottos.geojson      # emitted dataset the frontend loads
scripts/src/pipeline/  # the data pipeline (TypeScript)
  roster.ts  grottoPage.ts  town.ts
  geocode.ts  merge.ts  states.ts  build.ts  types.ts
src/                   # frontend (Vite + Leaflet)
  main.ts  map.ts  geo.ts  styles.css
tests/                 # vitest unit tests + saved page fixtures
.github/workflows/     # ci.yml (PR checks) + sync-grottos.yml (weekly sync)
```

---

## Running the pipeline locally

```bash
npm install

# Full live run: fetch the API roster, scrape each grotto page for town +
# website, geocode new towns, emit grottos.geojson. (~236 page fetches.)
npm run pipeline

# Offline re-emit: use the committed data/scraped.json + cache, no network.
# Useful for testing the merge/emit logic and overrides.
npm run pipeline:offline
```

The pipeline writes to `data/roster.json`, `data/scraped.json`,
`data/geocode-cache.json`, and `public/grottos.geojson`. Review the diff before
committing.

**Safety guard:** if the roster yields fewer than **150** grottos, the pipeline
**aborts non-zero without overwriting committed data**. A near-empty result
means the source changed and a parser broke — a broken run must never wipe the
dataset. In CI this fails the sync job loudly instead of opening a PR that
deletes everything.

---

## How overrides work

`data/overrides.json` is the human escape hatch. **Overrides always win and
survive every re-scrape.** Keys are grotto names (case-insensitive, whitespace-
collapsed); keys starting with `_` are ignored (used for comments/examples).

```jsonc
{
  "Huntsville Grotto": { "lat": 34.7304, "lng": -86.5861, "note": "pin exact town centroid" },
  "Some Defunct Grotto": { "exclude": true, "note": "no longer active" },
  "Misplaced Grotto": { "town": "Correct Town", "state": "TN" },
  "Renamed Club": { "name": "New Name", "contact_url": "https://example.org" }
}
```

Supported fields: `exclude`, `town`, `state`, `lat` + `lng`, `name`,
`contact_url`, `note`. A grotto with no town and no coordinate override is
logged as "unplaced" and omitted from the map (it can't be located) — add a
`town` or `lat`/`lng` override to place it. The shipped overrides give towns to
the handful of active grottos whose page has no address block (sourced from
their caves.org descriptions). Defunct grottos drop out automatically by not
being in the API roster — no exclusions needed.

### Regions

The source is organized by **state**, not by NSS region. A coarse, human-
friendly grouping (Northeast, Mid-Atlantic, Southeast / TAG, Midwest, South
Central, West, Pacific) is **derived** from the state in
`scripts/src/pipeline/states.ts` and shown in each grotto's popup. It is not an
official NSS administrative boundary.

---

## Sync workflow

`.github/workflows/sync-grottos.yml` runs the pipeline on a **weekly cron**
(Mondays) and on **manual `workflow_dispatch`**. If `grottos.geojson` (or the
cache/scrape) changed, it opens a **pull request** with the diff so you review
changes — and catch parser breakage — before they go live. It never pushes to
`main`.

> Requires repo setting **Settings → Actions → General → Workflow permissions →
> "Allow GitHub Actions to create and approve pull requests."**

---

## Frontend & Cloudflare Pages

The frontend is a static Vite app using **Leaflet** with **CARTO "Voyager"
basemap tiles** (colorful but clean, free, no key, OSM data, and `@2x` retina
tiles so the map stays sharp on HiDPI displays). Every grotto is shown as its
own marker at all zoom levels. It loads `grottos.geojson`, offers "nearest to
me" via browser geolocation (with a graceful **ZIP / Town, ST** fallback when
geolocation is denied), and marker popups linking to each club's site.

```bash
npm run dev       # local dev server
npm run build     # production build -> dist/
npm run preview   # preview the production build
```

### Cloudflare Pages setup

Deploy from the GitHub repo; auto-deploys on push to `main`.

| Setting | Value |
| --- | --- |
| **Framework preset** | None (Vite) |
| **Build command** | `npm run build` |
| **Build output directory** | `dist` |
| **Node version** | 20 (set `NODE_VERSION=20` if needed) |

`public/grottos.geojson` is copied into `dist/` by Vite and served at the site
root, which is where the app fetches it.

---

## Tests

```bash
npm test          # vitest
npm run typecheck # tsc --noEmit
```

Coverage focuses on the risky logic: town/website extraction from grotto pages
(against saved page fixtures in `tests/fixtures/`, including the privacy
guarantee that no street fragment leaks into a town) and the geo math
(`haversine`, `nearest`, GeoJSON parsing).

## Attribution

- Grotto data: [caves.org](https://caves.org/find-a-grotto/) (National Speleological Society).
- Geocoding: © [OpenStreetMap](https://openstreetmap.org/copyright) contributors (Nominatim).
- Basemap tiles: © [OpenStreetMap](https://openstreetmap.org/copyright) contributors, © [CARTO](https://carto.com/attributions).

## License

[GNU General Public License v3.0 or later](./LICENSE).
