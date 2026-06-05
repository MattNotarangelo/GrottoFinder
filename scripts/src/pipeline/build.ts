// Pipeline orchestrator: scrape -> geocode -> merge with overrides -> emit
// public/grottos.geojson.
//
// Run:   npm run pipeline            (live scrape + geocode)
//        npm run pipeline:offline    (use committed data/scraped.json + cache;
//                                     no network — for CI and quick re-emits)
//
// SAFETY GUARD: if the scrape yields fewer than MIN_GROTTOS, the run ABORTS
// non-zero WITHOUT overwriting any committed data. A near-empty result means
// the source HTML changed and the parser broke; a broken scrape must never
// wipe the dataset.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scrape, SOURCE_URL } from "./scrape.js";
import { geocodeAll } from "./geocode.js";
import { merge, toGeoJSON, geocodeTargets } from "./merge.js";
import type { ScrapedGrotto, GeocodeCache, Overrides } from "./types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DATA = join(ROOT, "data");
const PUBLIC = join(ROOT, "public");
const SCRAPED_PATH = join(DATA, "scraped.json");
const CACHE_PATH = join(DATA, "geocode-cache.json");
const OVERRIDES_PATH = join(DATA, "overrides.json");
const GEOJSON_PATH = join(PUBLIC, "grottos.geojson");

/** There are ~207 active grottos; abort well below that to catch a broken parse. */
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

async function main(): Promise<void> {
  const offline = process.argv.includes("--no-network");

  // 1. SCRAPE (or load committed scrape in offline mode).
  let scraped: ScrapedGrotto[];
  if (offline) {
    log(`[scrape] offline mode: loading ${SCRAPED_PATH}`);
    scraped = readJSON<ScrapedGrotto[]>(SCRAPED_PATH, []);
  } else {
    log(`[scrape] fetching ${SOURCE_URL}`);
    scraped = await scrape();
  }
  log(`[scrape] parsed ${scraped.length} grottos`);

  // SAFETY GUARD — never let a broken scrape wipe committed data.
  if (scraped.length < MIN_GROTTOS) {
    log(
      `[ABORT] scrape yielded ${scraped.length} grottos (< ${MIN_GROTTOS}). ` +
        `The source likely changed and the parser broke. ` +
        `Refusing to overwrite committed data.`
    );
    process.exit(1);
  }
  if (!offline) writeJSON(SCRAPED_PATH, scraped);

  // 2. GEOCODE (town centroids; cached). Geocode the OVERRIDE-CORRECTED towns
  // so a town-fix override (e.g. a typo in the source) actually gets coords.
  const overrides = readJSON<Overrides>(OVERRIDES_PATH, {});
  const cache = readJSON<GeocodeCache>(CACHE_PATH, {});
  const toGeocode = geocodeTargets(scraped, overrides);
  log(`[geocode] ${toGeocode.length} town targets; cache has ${Object.keys(cache).length}`);
  const geo = await geocodeAll(toGeocode, cache, !offline, log);
  writeJSON(CACHE_PATH, sortCache(geo.cache));
  log(`[geocode] fetched ${geo.fetched} new; ${geo.failures.length} unresolved`);

  // 3. MERGE with overrides.
  const result = merge(scraped, geo.cache, overrides, today());
  if (result.excluded) log(`[merge] excluded ${result.excluded} via overrides`);
  if (result.unplaced.length)
    log(`[merge] ${result.unplaced.length} unplaced (no coords): ${result.unplaced.join(", ")}`);
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
