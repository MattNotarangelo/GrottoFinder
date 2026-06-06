// Merge scraped grottos with the geocode cache and hand-maintained overrides,
// producing the final emitted records.
//
// Overrides ALWAYS win and survive every re-scrape. They are keyed by the
// grotto's name (normalized: lowercased, whitespace-collapsed). See
// data/overrides.json and the README "How overrides work".

import type { ScrapedGrotto, GeocodeCache, Override, Overrides, Grotto } from "./types.js";
import { geocodeKey } from "./geocode.js";
import { regionForState } from "./states.js";

/** Normalize a grotto name into a stable override key. */
export function grottoKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Build the case-insensitive override lookup map. Keys starting with "_" are
 * documentation/meta and are ignored.
 */
export function buildOverrideMap(overrides: Overrides): Map<string, Override> {
  return new Map(
    Object.entries(overrides)
      .filter(([k]) => !k.startsWith("_"))
      .map(([k, v]) => [grottoKey(k), v])
  );
}

/**
 * The effective town/state for each grotto AFTER applying town/state overrides,
 * for grottos that aren't excluded and have a town. Geocoding must run on these
 * (not the raw scraped towns) so a town-correction override actually geocodes.
 */
export function geocodeTargets(
  scraped: ScrapedGrotto[],
  overrides: Overrides
): Array<{ town: string; state: string }> {
  const map = buildOverrideMap(overrides);
  const out: Array<{ town: string; state: string }> = [];
  for (const g of scraped) {
    const ov = map.get(grottoKey(g.name));
    if (ov?.exclude) continue;
    // A coordinate override means we don't need to geocode this one.
    if (typeof ov?.lat === "number" && typeof ov?.lng === "number") continue;
    const town = ov?.town ?? g.town;
    const state = (ov?.state ?? g.state).toUpperCase();
    if (town) out.push({ town, state });
  }
  return out;
}

export interface MergeResult {
  grottos: Grotto[];
  /** Names that had a town but no coordinates (geocode miss, no override). */
  unplaced: string[];
  /** Override keys that matched no scraped grotto (likely stale). */
  staleOverrides: string[];
  /** Number of grottos excluded via overrides. */
  excluded: number;
}

export function merge(
  scraped: ScrapedGrotto[],
  cache: GeocodeCache,
  overrides: Overrides,
  lastSeen: string
): MergeResult {
  const overrideMap = buildOverrideMap(overrides);
  const usedOverrides = new Set<string>();

  const grottos: Grotto[] = [];
  const unplaced: string[] = [];
  let excluded = 0;

  for (const g of scraped) {
    const key = grottoKey(g.name);
    const ov = overrideMap.get(key);
    if (ov) usedOverrides.add(key);

    if (ov?.exclude) {
      excluded += 1;
      continue;
    }

    // Apply field corrections (overrides win).
    const name = ov?.name ?? g.name;
    const town = ov?.town ?? g.town;
    const state = (ov?.state ?? g.state).toUpperCase();
    const contactUrl = ov?.contact_url !== undefined ? ov.contact_url : g.contactUrl;

    // Coordinates: explicit override coords win, else the geocode cache.
    let lat: number | undefined;
    let lng: number | undefined;
    if (typeof ov?.lat === "number" && typeof ov?.lng === "number") {
      lat = ov.lat;
      lng = ov.lng;
    } else if (town) {
      const hit = cache[geocodeKey(town, state)];
      if (hit) {
        lat = hit.lat;
        lng = hit.lng;
      }
    }

    if (lat === undefined || lng === undefined) {
      unplaced.push(name);
      continue; // cannot place on the map without coordinates
    }

    grottos.push({
      name,
      region: regionForState(state),
      town,
      state,
      contact_url: contactUrl,
      lat,
      lng,
      last_seen: lastSeen,
    });
  }

  const staleOverrides = [...overrideMap.keys()].filter((k) => !usedOverrides.has(k));
  return { grottos, unplaced, staleOverrides, excluded };
}

/** Build a GeoJSON FeatureCollection from final grotto records. */
export function toGeoJSON(grottos: Grotto[]): unknown {
  return {
    type: "FeatureCollection",
    features: grottos.map((g) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [g.lng, g.lat] },
      properties: {
        name: g.name,
        region: g.region,
        town: g.town,
        state: g.state,
        contact_url: g.contact_url,
        last_seen: g.last_seen,
      },
    })),
  };
}
