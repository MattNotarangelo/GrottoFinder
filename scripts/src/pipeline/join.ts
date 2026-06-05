// Join the authoritative API roster (which grottos are active) with the legacy
// list (which carries town + website). The result is a ScrapedGrotto[] that the
// rest of the pipeline (geocode -> merge -> emit) consumes unchanged.
//
// - Roster grotto matched to a legacy entry  -> gets its town + website.
// - Roster grotto with no legacy match        -> no town (admin orgs, brand-new
//   grottos); emitted only if an override supplies a town/coords.
// - Legacy entry not in the roster            -> DROPPED (defunct, e.g. one the
//   current site removed). Surfaced in `legacyOnlyDropped` for review.
//
// Names differ between sources, so matching uses normalizeName() plus an
// optional alias map (API name -> legacy name) from overrides "_aliases".

import type { ScrapedGrotto } from "./types.js";
import type { RosterGrotto } from "./roster.js";
import { normalizeName } from "./names.js";

export { decodeName } from "./names.js";

export interface JoinResult {
  grottos: ScrapedGrotto[];
  matched: number;
  /** Roster names with no legacy match (no town unless an override adds one). */
  apiOnly: string[];
  /** Legacy names absent from the roster — treated as defunct and dropped. */
  legacyOnlyDropped: string[];
}

export function joinRosterWithLegacy(
  roster: RosterGrotto[],
  legacy: ScrapedGrotto[],
  aliases: Record<string, string> = {}
): JoinResult {
  // Legacy lookup by normalized name (first wins on the rare collision).
  const legacyByKey = new Map<string, ScrapedGrotto>();
  for (const g of legacy) {
    const key = normalizeName(g.name);
    if (!legacyByKey.has(key)) legacyByKey.set(key, g);
  }

  // Alias map: normalized API name -> normalized legacy name.
  const aliasByKey = new Map<string, string>();
  for (const [apiName, legacyName] of Object.entries(aliases)) {
    aliasByKey.set(normalizeName(apiName), normalizeName(legacyName));
  }

  const grottos: ScrapedGrotto[] = [];
  const apiOnly: string[] = [];
  const matchedLegacyKeys = new Set<string>();
  let matched = 0;

  for (const r of roster) {
    const key = normalizeName(r.name);
    const legacyKey = aliasByKey.get(key) ?? key;
    const hit = legacyByKey.get(legacyKey);

    // Link preference: the club's own website (from legacy) if present,
    // otherwise the grotto's page on caves.org.
    const cavesPage = r.link || null;

    if (hit) {
      matched += 1;
      matchedLegacyKeys.add(legacyKey);
      grottos.push({
        name: r.name, // API name is authoritative for display
        town: hit.town,
        state: hit.town ? hit.state : (r.states[0] ?? hit.state),
        contactUrl: hit.contactUrl ?? cavesPage,
      });
    } else {
      apiOnly.push(r.name);
      grottos.push({
        name: r.name,
        town: "",
        state: r.states[0] ?? "",
        contactUrl: cavesPage,
      });
    }
  }

  const legacyOnlyDropped = legacy
    .filter((g) => !matchedLegacyKeys.has(normalizeName(g.name)))
    .map((g) => g.name);

  return { grottos, matched, apiOnly, legacyOnlyDropped };
}
