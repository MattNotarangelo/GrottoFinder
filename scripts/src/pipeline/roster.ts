// Fetch the authoritative ACTIVE-grotto roster from the current caves.org
// WordPress REST API. This decides WHICH grottos exist; town + website are then
// scraped from each grotto's page (see grottoPage.ts).
//
// The API's "grottos" post type also contains non-grotto entities (cave
// surveys, NSS regions, sections) — these carry no state tag and no town, so
// they naturally fall out of the map (they never get coordinates). We keep them
// in the roster rather than guessing a blocklist; the "unplaced" log makes them
// visible.

import { STATE_NAMES } from "./states.js";
import { decodeEntities } from "./town.js";

/** Decode entities, collapse whitespace, and trim a title/name. */
const cleanName = (s: string): string => decodeEntities(s).replace(/\s+/g, " ").trim();

const API_BASE = "https://caves.org/wp-json/wp/v2";
const USER_AGENT = "GrottoFinder/1.0 (NSS grotto locator; periodic sync)";
const PER_PAGE = 100;

export interface RosterGrotto {
  name: string;
  /** USPS code(s) from the API's state taxonomy; [] for non-grotto entities. */
  states: string[];
  /** The grotto's own page on caves.org (permalink); used as a link fallback. */
  link: string;
}

interface ApiGrotto {
  title?: { rendered?: string };
  state?: number[];
  link?: string;
}

interface ApiStateTerm {
  id: number;
  name: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`API HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

/** name -> USPS code, e.g. "Oregon" -> "OR". */
function buildStateNameToCode(): Map<string, string> {
  const m = new Map<string, string>();
  for (const [code, name] of Object.entries(STATE_NAMES)) m.set(name.toLowerCase(), code);
  return m;
}

/** Fetch the state taxonomy and return a term-id -> USPS-code map. */
async function fetchStateTermMap(): Promise<Map<number, string>> {
  const terms = await getJson<ApiStateTerm[]>(`${API_BASE}/state?per_page=${PER_PAGE}&_fields=id,name`);
  const nameToCode = buildStateNameToCode();
  const out = new Map<number, string>();
  for (const t of terms) {
    const code = nameToCode.get(cleanName(t.name).toLowerCase());
    if (code) out.set(t.id, code);
  }
  return out;
}

/** Fetch every grotto in the API roster (paginated), resolving state codes. */
export async function fetchRoster(): Promise<RosterGrotto[]> {
  const stateMap = await fetchStateTermMap();
  const out: RosterGrotto[] = [];
  for (let page = 1; ; page++) {
    const url = `${API_BASE}/grottos?per_page=${PER_PAGE}&page=${page}&_fields=title,state,link`;
    const batch = await getJson<ApiGrotto[]>(url);
    if (batch.length === 0) break;
    for (const g of batch) {
      const name = cleanName(g.title?.rendered ?? "");
      if (!name) continue;
      const states = (g.state ?? [])
        .map((id) => stateMap.get(id))
        .filter((c): c is string => Boolean(c));
      out.push({ name, states, link: g.link ?? "" });
    }
    if (batch.length < PER_PAGE) break;
  }
  return out;
}
