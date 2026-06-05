// Geocoding: town/state -> lat/lng centroid.
//
// WHY NOMINATIM (not the US Census Geocoder): the brief suggested the Census
// Geocoder, but its /locations endpoint only matches full STREET addresses --
// verified to return zero matches for town-only inputs like "Huntsville, AL".
// Since we deliberately geocode TOWN CENTROIDS ONLY (never a street; see the
// privacy constraint), Nominatim/OpenStreetMap is the correct free, no-key
// tool: it returns a municipality's centroid for "Town, ST, USA".
//
// We are gentle citizens of the free Nominatim service:
//   - a descriptive User-Agent (required by their usage policy),
//   - at most one request per second,
//   - and EVERY result cached by input string in data/geocode-cache.json so a
//     re-scrape geocodes only genuinely new towns.

import type { GeocodeCache, GeocodeResult } from "./types.js";
import { STATE_NAMES } from "./states.js";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "GrottoFinder/1.0 (NSS grotto locator; town-centroid geocoder)";
const MIN_REQUEST_INTERVAL_MS = 1100;

/** Stable cache key for a town/state pair. */
export function geocodeKey(town: string, state: string): string {
  return `${town.trim()}, ${state.trim().toUpperCase()}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Query Nominatim for a single town centroid. Returns null on no match. */
async function queryNominatim(town: string, state: string): Promise<GeocodeResult | null> {
  const stateName = STATE_NAMES[state.toUpperCase()] ?? state;
  const params = new URLSearchParams({
    q: `${town}, ${stateName}, USA`,
    format: "json",
    limit: "1",
    countrycodes: "us",
  });
  const res = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status} for "${town}, ${state}"`);
  const body = (await res.json()) as Array<{ lat: string; lon: string }>;
  const hit = body[0];
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, source: "nominatim" };
}

export interface GeocodeRunResult {
  cache: GeocodeCache;
  /** town/state keys that could not be geocoded this run. */
  failures: string[];
  /** count of fresh (non-cached) lookups performed. */
  fetched: number;
}

/**
 * Resolve coordinates for a set of unique town/state keys, using the cache
 * first and Nominatim for the rest. The returned cache should be persisted.
 *
 * @param allowNetwork when false, only cached entries are used (offline/CI).
 */
export async function geocodeAll(
  keys: Array<{ town: string; state: string }>,
  cache: GeocodeCache,
  allowNetwork: boolean,
  log: (msg: string) => void = console.error
): Promise<GeocodeRunResult> {
  const nextCache: GeocodeCache = { ...cache };
  const failures: string[] = [];
  let fetched = 0;

  // De-duplicate so each town/state is looked up at most once.
  const unique = new Map<string, { town: string; state: string }>();
  for (const k of keys) unique.set(geocodeKey(k.town, k.state), k);

  for (const [key, { town, state }] of unique) {
    if (nextCache[key]) continue; // already known
    if (!allowNetwork) {
      failures.push(key);
      continue;
    }
    try {
      await sleep(MIN_REQUEST_INTERVAL_MS);
      const result = await queryNominatim(town, state);
      if (result) {
        nextCache[key] = result;
        fetched += 1;
        log(`  geocoded ${key} -> ${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}`);
      } else {
        failures.push(key);
        log(`  NO MATCH for ${key}`);
      }
    } catch (err) {
      failures.push(key);
      log(`  ERROR geocoding ${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { cache: nextCache, failures, fetched };
}
