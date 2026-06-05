// Fetch the legacy NSS grotto list and parse it. See parse.ts for the source
// URL, structure, and the privacy rules governing what we extract.

import { parseGrottos } from "./parse.js";
import type { ScrapedGrotto } from "./types.js";

export const SOURCE_URL =
  "https://legacy.caves.org/committee/i-o/grottos/grottos.shtml";

const USER_AGENT = "GrottoFinder/1.0 (NSS grotto locator; periodic sync)";

/** Fetch and parse the live source. Throws on network/HTTP failure. */
export async function scrape(): Promise<ScrapedGrotto[]> {
  const res = await fetch(SOURCE_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Source HTTP ${res.status} fetching ${SOURCE_URL}`);
  const html = await res.text();
  return parseGrottos(html);
}
