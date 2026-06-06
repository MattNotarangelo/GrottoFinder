// Legacy I/O-committee list — used ONLY as a town FALLBACK for grottos whose
// current caves.org page lists no mappable address. The current pages remain
// the primary source; this fills the gaps (the legacy table has a clean
// `Town, ST ZIP` for many clubs whose new page only lists an email).
//
// Matched to the roster by normalized name. Town-level only — reuses the same
// privacy-preserving extractor as the page scraper.

import { parse } from "node-html-parser";
import { extractTownState, decodeEntities } from "./town.js";
import { normalizeName } from "./names.js";

const LEGACY_URL = "https://legacy.caves.org/committee/i-o/grottos/grottos.shtml";
const USER_AGENT = "GrottoFinder/1.0 (NSS grotto locator; periodic sync)";

export type LegacyTowns = Map<string, { town: string; state: string }>;

function htmlToLines(innerHTML: string): string[] {
  return decodeEntities(innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Parse the legacy table into normalizedName -> {town, state} (towns only). */
export function parseLegacyTowns(html: string): LegacyTowns {
  const root = parse(html, { blockTextElements: { script: false, style: false } });
  const out: LegacyTowns = new Map();
  for (const td of root.querySelectorAll("td")) {
    const strong = td.querySelector("strong");
    if (!strong) continue;
    // Entry cells carry a multi-line address; state-header cells do not.
    if (!/<br\s*\/?>/i.test(td.innerHTML)) continue;
    const name = decodeEntities(strong.text).replace(/\s+/g, " ").trim();
    if (!name) continue;
    const { town, state } = extractTownState(htmlToLines(td.innerHTML));
    if (town) out.set(normalizeName(name), { town, state });
  }
  return out;
}

export async function fetchLegacyTowns(): Promise<LegacyTowns> {
  const res = await fetch(LEGACY_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Legacy list HTTP ${res.status}`);
  return parseLegacyTowns(await res.text());
}
