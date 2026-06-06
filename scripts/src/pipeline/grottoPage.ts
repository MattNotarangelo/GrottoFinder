// Parse a grotto's page on caves.org for its TOWN and club WEBSITE.
//
// Each /grotto/<slug>/ page has a "Contact Information" block (often a member's
// home address) and, in the body, the club's own website among NSS site-wide
// social links. We take:
//   - town: town-level only, via town.ts (street/name/phone discarded).
//   - website: the club's external site, filtering out NSS's own social
//     accounts; falls back to the grotto's caves.org page (the roster link).

import type { ScrapedGrotto } from "./types.js";
import type { RosterGrotto } from "./roster.js";
import { decodeEntities, extractTownState } from "./town.js";

const USER_AGENT = "GrottoFinder/1.0 (NSS grotto locator; periodic sync)";
const PAGE_FETCH_DELAY_MS = 200; // be polite to caves.org

// Hosts/links that are never the club's own website. NOTE: caves.org is NOT
// here — many grottos' sites are hosted on a caves.org SUBDOMAIN (e.g.
// ohdgrotto.caves.org), which is a real club site. We exclude only the apex
// caves.org (the NSS site + the grotto's own /grotto/ directory page) in
// pickWebsite(), while keeping subdomains.
const NON_CLUB = [
  "gmpg.org",
  "w.org",
  "gstatic.com",
  "googleapis.com",
  "google.com",
  "schema.org",
  "wordpress.org",
  "gravatar.com",
];
// caves.org hosts that are NSS infrastructure (present on every page), not a
// grotto's site. The apex caves.org is handled separately. Any OTHER caves.org
// subdomain (e.g. ohdgrotto.caves.org) is treated as a club site.
const CAVES_NSS_HOSTS = ["members.caves.org", "legacy.caves.org", "store.caves.org"];
// NSS's own site-wide social accounts (present in the header/footer of every
// grotto page) — not the individual club.
const NSS_SOCIAL = [
  "nsscaves",
  "nationalspeleologicalsociety",
  "linkedin.com/groups/106900",
  "pinterest.com/nsscaves",
];
const SOCIAL_HOSTS = [
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "pinterest.com",
  "youtube.com",
  "tiktok.com",
  "threads.net",
];
const ASSET_EXT = /\.(css|js|png|jpe?g|svg|ico|woff2?|gif|webp)(\?|$)/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Convert page HTML into clean text lines (block/<br> boundaries -> newlines). */
function pageLines(html: string): string[] {
  const text = decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|td|address)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
  return text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Choose the club's website from the page's external links. */
export function pickWebsite(html: string): string | null {
  const hrefs = [...html.matchAll(/href="(https?:\/\/[^"]+)"/gi)].map((m) => m[1]!);
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const href of hrefs) {
    const lower = href.toLowerCase();
    if (ASSET_EXT.test(href)) continue;
    if (NSS_SOCIAL.some((s) => lower.includes(s))) continue;
    const host = hostOf(href);
    if (!host) continue;
    // Apex caves.org (NSS site / the grotto's own directory page) and NSS
    // infrastructure subdomains (members/legacy/store) are skipped; but other
    // caves.org SUBDOMAINS (e.g. ohdgrotto.caves.org) are grotto-hosted sites.
    if (host === "caves.org" || CAVES_NSS_HOSTS.includes(host)) continue;
    if (NON_CLUB.some((h) => host === h || host.endsWith("." + h))) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    candidates.push(href);
  }
  // Prefer a real (non-social) club website; else a club social page; else none.
  const nonSocial = candidates.find((u) => !SOCIAL_HOSTS.includes(hostOf(u)));
  return nonSocial ?? candidates[0] ?? null;
}

/**
 * Isolate the page's "Contact Information" block. We must NOT scan the whole
 * page: every page's footer carries the NSS national HQ address (Huntsville,
 * AL), which would otherwise be mistaken for the grotto's town.
 */
function contactBlock(html: string): string {
  const start = html.search(/Contact Information/i);
  if (start < 0) return "";
  const rest = html.slice(start);
  const end = rest.search(/meeting information|<footer|id="footer"|class="[^"]*footer/i);
  return end > 0 ? rest.slice(0, end) : rest.slice(0, 1500);
}

/** Parse a single grotto page into town/state/website. Pure & testable. */
export function parseGrottoPage(
  html: string,
  fallbackState: string
): { town: string; state: string; website: string | null } {
  const { town, state } = extractTownState(pageLines(contactBlock(html)));
  return {
    town,
    state: town ? state || fallbackState : fallbackState,
    website: pickWebsite(html),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch and parse every grotto's page into ScrapedGrotto records. Town comes
 * from the page (town-level only); contactUrl is the club website or, failing
 * that, the grotto's caves.org page.
 */
export async function fetchGrottos(
  roster: RosterGrotto[],
  log: (msg: string) => void = console.error
): Promise<ScrapedGrotto[]> {
  const out: ScrapedGrotto[] = [];
  let withTown = 0;
  for (const g of roster) {
    let html = "";
    try {
      const res = await fetch(g.link, {
        signal: AbortSignal.timeout(20000),
        headers: { "User-Agent": USER_AGENT },
      });
      if (res.ok) html = await res.text();
      else log(`  page HTTP ${res.status} for ${g.name} (${g.link})`);
    } catch (err) {
      log(`  page ERROR for ${g.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const fallbackState = g.states[0] ?? "";
    const parsed = html
      ? parseGrottoPage(html, fallbackState)
      : { town: "", state: fallbackState, website: null };
    if (parsed.town) withTown += 1;
    out.push({
      name: g.name,
      town: parsed.town,
      state: parsed.state,
      contactUrl: parsed.website ?? g.link, // fall back to the caves.org page
    });
    await sleep(PAGE_FETCH_DELAY_MS);
  }
  log(`[pages] parsed ${out.length} pages; ${withTown} yielded a town`);
  return out;
}
