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
and `tests/parse.test.ts` asserts that no extracted town contains a street
fragment.

---

## Data source: which one, and why

There is no public NSS API. We investigated the three candidate sources by
looking at the **actual markup and network traffic** (not assumptions):

| Source | What we found | Verdict |
| --- | --- | --- |
| [`caves.org/find-a-grotto`](https://caves.org/find-a-grotto/) (current site) | WordPress + Beaver Builder + WooCommerce. The static HTML contains **zero grotto listings** — only marketing prose (the word "grotto" appears 33×, all in copy). The listings load client-side via a Google-Maps-backed plugin; the `admin-ajax.php` calls in the page are WooCommerce order-attribution noise, **not** a grotto data endpoint. | ❌ Rejected — would require a headless browser and reverse-engineering a map plugin; brittle. |
| [`legacy.caves.org/.../grottos.shtml`](https://legacy.caves.org/committee/i-o/grottos/grottos.shtml) (I/O committee legacy list) | A **hand-maintained static HTML table** generated from a spreadsheet (there's an editor comment in the source explaining the update procedure). One fetch returns **~207 entries** with exactly the fields we need: club name, `Town, ST ZIP`, and club website. No JavaScript, no auth. | ✅ **Chosen.** |
| The 12 regional sites | Inconsistent structure site-to-site; 12 separate parsers to maintain. | ❌ Not needed. |

**We use the legacy I/O committee list.** It is the only machine-parseable
source, its structure is stable (a human edits one spreadsheet column and
uploads), and it carries town-level geography directly. Risk: it can lag the
"current" site. Mitigations: the weekly sync opens a **PR with a diff** so a
human reviews changes, and `data/overrides.json` lets a human correct anything.

### Parsing approach

`scripts/src/pipeline/parse.ts` is a pure, unit-tested function. The source
table is messy real-world HTML (doubled attribute quotes like `valign=""top""`,
unclosed `<a name>` anchors), so the parser is deliberately forgiving:

- Entries are `<td>` cells whose first child is `<strong>Club Name</strong>`
  followed by `<br>`-separated address lines. Entry cells are distinguished from
  state-header cells by the presence of an address block.
- **State** comes from the `Town, ST ZIP` line (with a raw-offset `<a name="XX">`
  section scan as fallback). The DOM anchor query is unreliable here because the
  anchors are unclosed, so we don't depend on it.
- **Town** extraction handles every format variant present in the source —
  `City, ST ZIP`, `City ST ZIP`, `City, ST, ZIP`, `Street, City ST ZIP`,
  lowercase states (`Pa`), and street-on-the-same-line cases. It pulls the city
  out of a street-bearing line and **never emits a street fragment** (e.g.
  `6740 Marguerite St, Juneau AK 99801` → `Juneau`; `St. Louis` is preserved,
  not mistaken for a street).
- Names are **not** keyed on the word "Grotto" — ~45 clubs are named "… Cavers",
  "… Society", "… Troglodytes", etc.

Of ~207 entries, ~201 yield a clean US town; the remainder are address-less or
foreign entries handled via overrides (see below).

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
  scraped.json         # raw parsed grottos (regenerated each live run)
  geocode-cache.json   # town,ST -> lat,lng cache (committed; grows over time)
  overrides.json       # hand-maintained corrections; ALWAYS win
public/
  grottos.geojson      # emitted dataset the frontend loads
scripts/src/pipeline/  # the data pipeline (TypeScript)
  parse.ts  scrape.ts  geocode.ts  merge.ts  states.ts  build.ts  types.ts
src/                   # frontend (Vite + Leaflet)
  main.ts  map.ts  geo.ts  styles.css
tests/                 # vitest unit tests + saved source fixture
.github/workflows/     # ci.yml (PR checks) + sync-grottos.yml (weekly sync)
```

---

## Running the pipeline locally

```bash
npm install

# Full live run: scrape the source, geocode new towns, emit grottos.geojson.
npm run pipeline

# Offline re-emit: use the committed data/scraped.json + geocode-cache.json,
# no network. Useful for testing the merge/emit logic and overrides.
npm run pipeline:offline
```

The pipeline writes to `data/scraped.json`, `data/geocode-cache.json`, and
`public/grottos.geojson`. Review the diff before committing.

**Safety guard:** if the scrape yields fewer than **150** grottos (there are
~207), the pipeline **aborts non-zero without overwriting committed data**. A
near-empty result means the source HTML changed and the parser broke — a broken
scrape must never wipe the dataset. In CI this fails the sync job loudly instead
of opening a PR that deletes everything.

---

## How overrides work

`data/overrides.json` is the human escape hatch. **Overrides always win and
survive every re-scrape.** Keys are grotto names (case-insensitive, whitespace-
collapsed); keys starting with `_` are ignored (used for comments/examples).

```jsonc
{
  "Huntsville Grotto": { "lat": 34.7304, "lng": -86.5861, "note": "pin exact town centroid" },
  "Some Defunct Grotto": { "exclude": true, "note": "no longer active" },
  "Misspelled Twon Grotto": { "town": "Correct Town", "state": "TN" },
  "Renamed Club": { "name": "New Name", "contact_url": "https://example.org" }
}
```

Supported fields: `exclude`, `town`, `state`, `lat` + `lng`, `name`,
`contact_url`, `note`. A grotto with no town and no coordinate override is
logged as "unplaced" and omitted from the map (it can't be located) — add a
`town` or `lat`/`lng` override to place it. The shipped overrides exclude four
foreign grottos (Costa Rica, Philippines, Mexico, Israel) that the source lists
but that fall outside a US "nearest-to-me" map.

### Regions

The source is organized by **state**, not by NSS region. The map's region filter
uses a coarse, human-friendly grouping (Northeast, Mid-Atlantic, Southeast / TAG,
Midwest, South Central, West, Pacific) **derived** from the state in
`scripts/src/pipeline/states.ts`. It is not an official NSS administrative
boundary.

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

The frontend is a static Vite app using **Leaflet + OpenStreetMap tiles** (no
key). Every grotto is shown as its own marker at all zoom levels. It loads
`grottos.geojson`, offers "nearest to me" via browser geolocation (with a
graceful **ZIP / Town, ST** fallback when geolocation is denied), a region
filter, and marker popups linking to each club's site.

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

Coverage focuses on the risky logic: the HTML parser (against a saved source
fixture in `tests/fixtures/`, including the privacy guarantee that no street
fragment leaks into a town) and the geo math (`haversine`, `nearest`,
GeoJSON parsing).

## Attribution

- Grotto data: [NSS I/O Committee grotto list](https://legacy.caves.org/committee/i-o/grottos/grottos.shtml).
- Geocoding & map tiles: © [OpenStreetMap](https://openstreetmap.org/copyright) contributors (Nominatim + OSM tiles).
