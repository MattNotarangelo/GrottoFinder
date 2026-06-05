// Parser for the legacy NSS grotto list.
//
// Source: https://legacy.caves.org/committee/i-o/grottos/grottos.shtml
// A hand-maintained static HTML table. Structure (verified against the saved
// fixture in tests/fixtures/):
//
//   - State sections are delimited by anchor cells: <a name="AL"> wrapping a
//     <font face="sans-serif"><strong>Alabama</strong></font>. (These <a> tags
//     are unclosed in the source, so we locate them by raw-text offset rather
//     than via the DOM, which mis-nests them.)
//   - Each grotto is a <td> whose first child is <strong>Club Name</strong>
//     followed by <br>-separated address lines, e.g.:
//         <strong>Glacier Grotto</strong><br>c/o David Love<br>
//         6740 Marguerite St, Juneau AK 99801<br>907-789-6833
//     The contact email/website live in the next <td> of the same row.
//
// PRIVACY (firm constraint): we extract ONLY the club name, the TOWN + STATE,
// and the club website. Street/PO lines, "c/o <person>" lines, and phone
// numbers are intentionally discarded. The town extractor is written to pull
// the city out of a street-bearing line and NEVER emit a street fragment.

import { parse } from "node-html-parser";
import type { ScrapedGrotto } from "./types.js";
import { VALID_STATES } from "./states.js";

const NON_CLUB_HOSTS = ["caves.org", "google.com", "recaptcha", "facebook.com/sharer"];

// Street-name suffixes used to strip a street off a line so only the city
// remains. Matched case-insensitively, optional trailing period.
const STREET_SUFFIX =
  /^(st|street|rd|road|ave|avenue|blvd|boulevard|dr|drive|ln|lane|ct|court|cir|circle|way|pkwy|parkway|hwy|highway|pl|place|ter|terrace|trl|trail|box|pike|sq|loop|run|row|path|pass)\.?$/i;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#0?38;/g, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/ /g, " ");
}

/** Convert an element's innerHTML into clean text lines split on <br>. */
function htmlToLines(innerHTML: string): string[] {
  return decodeEntities(innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Given a segment that may be "Street Name City" or just "City", return the
 * city only. Drops a leading street number and everything up to the last
 * street-suffix token. Returns "" if the result still looks like a street.
 */
function cityFromSegment(seg: string): string {
  const tokens = seg.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";

  // Find the last street-suffix token that is NOT the first token (so a city
  // like "St. Louis" — where "St." leads — is not mistaken for a street).
  let cut = -1;
  for (let i = 1; i < tokens.length; i++) {
    if (STREET_SUFFIX.test(tokens[i]!)) cut = i;
  }
  let cityTokens = cut >= 0 ? tokens.slice(cut + 1) : tokens.slice();

  // If no suffix was found but the segment starts with a street number, drop
  // the leading numeric tokens.
  if (cut < 0) {
    while (cityTokens.length > 1 && /^\d/.test(cityTokens[0]!)) cityTokens.shift();
  }

  const city = cityTokens.join(" ").trim();
  // Guard: a real town never contains a digit. If it does, extraction failed.
  if (!city || /\d/.test(city)) return "";
  return city;
}

/**
 * Extract town + state from a grotto's address lines. Handles the format
 * variants found in the source:
 *   "City, ST ZIP"          "City ST ZIP"
 *   "City, ST, ZIP"         "City ST, ZIP"
 *   "Street, City ST ZIP"   "Street City ST, ZIP"   lowercase state ("Pa")
 * Returns town="" when no parseable "...ST ZIP" line exists (e.g. an entry
 * that lists only a contact person) — those are surfaced for overrides.
 */
export function extractTownState(lines: string[]): { town: string; state: string } {
  for (const line of lines) {
    if (!/\d{5}/.test(line)) continue;
    // State code (2 letters, any case) immediately before the ZIP at line end.
    const m = /([A-Za-z]{2})\s*,?\s*(\d{5})(?:-\d{4})?\s*$/.exec(line);
    if (!m) continue;
    const state = m[1]!.toUpperCase();
    if (!VALID_STATES.has(state)) continue;

    // Everything before the state code, minus a trailing comma.
    const prefix = line.slice(0, m.index).replace(/[,\s]+$/, "");
    // The city is the last comma-separated segment (drops "Street," etc.).
    const seg = prefix.split(",").pop()!.trim();
    const town = cityFromSegment(seg);
    if (town) return { town, state };
  }
  return { town: "", state: "" };
}

function pickContactUrl(hrefs: string[]): string | null {
  for (const raw of hrefs) {
    const href = raw.trim();
    if (!/^https?:\/\//i.test(href)) continue; // skips mailto:, tel:, anchors
    if (NON_CLUB_HOSTS.some((h) => href.toLowerCase().includes(h))) continue;
    return href;
  }
  return null;
}

/**
 * Build an ordered list of [offset, stateCode] section boundaries from the
 * unclosed <a name="XX"> anchors, used as a fallback state for entries whose
 * address line has no parseable "ST ZIP".
 */
function sectionBoundaries(html: string): Array<{ idx: number; state: string }> {
  const out: Array<{ idx: number; state: string }> = [];
  for (const m of html.matchAll(/<a name="([A-Za-z]{2})">/g)) {
    const state = m[1]!.toUpperCase();
    if (VALID_STATES.has(state)) out.push({ idx: m.index!, state });
  }
  return out;
}

/**
 * Parse the legacy grotto-list HTML into ScrapedGrotto records.
 * Pure function — no network, no filesystem. Unit-tested against the fixture.
 */
export function parseGrottos(html: string): ScrapedGrotto[] {
  const root = parse(html, { blockTextElements: { script: false, style: false } });
  const sections = sectionBoundaries(html);
  const out: ScrapedGrotto[] = [];
  let searchCursor = 0;

  for (const td of root.querySelectorAll("td")) {
    const strong = td.querySelector("strong");
    if (!strong) continue;
    // Entry cells carry a multi-line address (<br>); state-header cells do not.
    if (!/<br\s*\/?>/i.test(td.innerHTML)) continue;

    const name = decodeEntities(strong.text).replace(/\s+/g, " ").trim();
    if (!name) continue;

    const lines = htmlToLines(td.innerHTML);
    const { town, state: addrState } = extractTownState(lines);

    // Fallback state from the enclosing <a name> section (for entries with no
    // parseable address line). Locate this entry's offset in the raw HTML.
    let state = addrState;
    if (!state) {
      const at = html.indexOf(`<strong>${strong.innerHTML}</strong>`, searchCursor);
      if (at >= 0) {
        searchCursor = at + 1;
        for (const b of sections) {
          if (b.idx <= at) state = b.state;
          else break;
        }
      }
    }

    const row = td.closest("tr") ?? td.parentNode;
    const hrefs = (row ?? td).querySelectorAll("a").map((a) => a.getAttribute("href") ?? "");

    out.push({ name, town, state, contactUrl: pickContactUrl(hrefs) });
  }

  return out;
}
