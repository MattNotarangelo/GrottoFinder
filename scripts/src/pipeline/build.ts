// Pipeline orchestrator: fetch API roster -> scrape each grotto's page for its
// town + website -> geocode -> merge with overrides -> emit grottos.geojson.
//
// Source: the current caves.org site only. The WordPress REST API
// (wp-json/wp/v2/grottos) is the authoritative roster of ACTIVE grottos; each
// grotto's /grotto/<slug>/ page supplies its town (town-level only) and the
// club website. See roster.ts, grottoPage.ts, and the README "Data source".
//
// Run:   npm run pipeline            (live: API + page scrape + geocode)
//        npm run pipeline:offline    (use committed data/*.json + cache; no
//                                     network — for CI and quick re-emits)
//
// SAFETY GUARD: if the roster yields fewer than MIN_GROTTOS, the run ABORTS
// non-zero WITHOUT overwriting any committed data. A near-empty result means a
// source changed and a parser broke; a broken run must never wipe the dataset.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchRoster, type RosterGrotto } from "./roster.js";
import { fetchGrottos } from "./grottoPage.js";
import { fetchLegacyTowns } from "./legacy.js";
import { normalizeName } from "./names.js";
import { geocodeAll } from "./geocode.js";
import { merge, toGeoJSON, geocodeTargets } from "./merge.js";
import type { ScrapedGrotto, GeocodeCache, Overrides } from "./types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DATA = join(ROOT, "data");
const PUBLIC = join(ROOT, "public");
const ROSTER_PATH = join(DATA, "roster.json");
const SCRAPED_PATH = join(DATA, "scraped.json");
const CACHE_PATH = join(DATA, "geocode-cache.json");
const OVERRIDES_PATH = join(DATA, "overrides.json");
const GEOJSON_PATH = join(PUBLIC, "grottos.geojson");

/** ~200+ active grottos; abort well below that to catch a broken source/parse. */
const MIN_GROTTOS = 150;

const log = (msg: string) => process.stderr.write(msg + "\n");

function readJSON<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Write JSON with sorted keys for stable, reviewable git diffs. */
function writeJSON(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function sortCache(cache: GeocodeCache): GeocodeCache {
  return Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function guardCount(label: string, n: number): void {
  if (n < MIN_GROTTOS) {
    log(
      `[ABORT] ${label} yielded ${n} grottos (< ${MIN_GROTTOS}). A source likely ` +
        `changed and a parser broke. Refusing to overwrite committed data.`
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const offline = process.argv.includes("--no-network");
  const overrides = readJSON<Overrides>(OVERRIDES_PATH, {});

  // 1. ROSTER + PAGES — the active roster (API) plus each grotto's town and
  // website scraped from its caves.org page. Offline mode reuses the committed
  // page-derived data/scraped.json and skips the network entirely.
  let scraped: ScrapedGrotto[];
  if (offline) {
    log(`[scrape] offline mode: loading ${SCRAPED_PATH}`);
    scraped = readJSON<ScrapedGrotto[]>(SCRAPED_PATH, []);
    guardCount("scraped data", scraped.length);
  } else {
    log(`[roster] fetching caves.org REST API`);
    const roster: RosterGrotto[] = await fetchRoster();
    log(`[roster] ${roster.length} grottos in the active roster`);
    guardCount("roster", roster.length);
    writeJSON(ROSTER_PATH, roster);

    log(`[pages] fetching ${roster.length} grotto pages for town + website`);
    scraped = await fetchGrottos(roster, log);

    // FALLBACK: pages are primary, but ~some clubs' current page lists only an
    // email. Fill those towns from the legacy I/O list (matched by name). If
    // the legacy site is unavailable, continue with page towns only.
    try {
      const legacy = await fetchLegacyTowns();
      let filled = 0;
      scraped = scraped.map((g) => {
        if (g.town) return g;
        const hit = legacy.get(normalizeName(g.name));
        if (!hit) return g;
        filled += 1;
        return { ...g, town: hit.town, state: hit.state || g.state };
      });
      log(`[fallback] filled ${filled} missing towns from the legacy list (${legacy.size} legacy towns)`);
    } catch (err) {
      log(`[fallback] legacy list unavailable (${err instanceof Error ? err.message : String(err)}); page towns only`);
    }

    writeJSON(SCRAPED_PATH, scraped);
  }

  // 2. GEOCODE (town centroids; cached). Geocode the OVERRIDE-CORRECTED towns
  // so a town-fix override (e.g. a typo in the source) actually gets coords.
  const cache = readJSON<GeocodeCache>(CACHE_PATH, {});
  const toGeocode = geocodeTargets(scraped, overrides);
  log(`[geocode] ${toGeocode.length} town targets; cache has ${Object.keys(cache).length}`);
  const geo = await geocodeAll(toGeocode, cache, !offline, log);
  writeJSON(CACHE_PATH, sortCache(geo.cache));
  log(`[geocode] fetched ${geo.fetched} new; ${geo.failures.length} unresolved`);

  // 3. MERGE with overrides.
  const result = merge(scraped, geo.cache, overrides, today());
  if (result.excluded) log(`[merge] excluded ${result.excluded} via overrides`);

  // Split the unplaced into actionable buckets: grottos that HAVE a state but
  // no town are real clubs needing a town override; entries with no state are
  // the API's non-local entities (cave surveys, NSS regions, sections) that are
  // correctly left off the map.
  const stateByName = new Map(scraped.map((g) => [g.name, g.state]));
  const missingTown = result.unplaced.filter((n) => stateByName.get(n));
  const nonLocal = result.unplaced.filter((n) => !stateByName.get(n));
  if (missingTown.length)
    log(`[merge] ${missingTown.length} active grottos missing a town (add a town override to map them): ${missingTown.join(", ")}`);
  if (nonLocal.length)
    log(`[merge] ${nonLocal.length} non-local entries skipped (cave surveys / regions / sections)`);
  if (result.staleOverrides.length)
    log(`[merge] WARNING stale override keys (matched nothing): ${result.staleOverrides.join(", ")}`);

  // 4. EMIT — sort by state then name for stable diffs.
  const sorted = [...result.grottos].sort(
    (a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name)
  );
  writeJSON(GEOJSON_PATH, toGeoJSON(sorted));
  log(`[emit] wrote ${sorted.length} grottos to ${GEOJSON_PATH}`);
}

main().catch((err) => {
  log(`[FATAL] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
