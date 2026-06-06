// Town extraction from address text — town-level ONLY.
//
// PRIVACY (firm constraint): grotto contact blocks routinely contain a member's
// home address, name, and phone. We extract ONLY the town + state and NEVER a
// street, name, or phone. The extractor is written to pull the city out of a
// street-bearing line and never emit a street fragment (verified by tests).

import { VALID_STATES, STATE_NAMES } from "./states.js";

// Resolve a 2-letter code OR a full state name (pages use both, e.g. "MD" and
// "Maryland") to a USPS code; "" if it isn't a real state.
const NAME_TO_CODE = new Map<string, string>(
  Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code])
);
const FULL_NAME_ALT = Object.values(STATE_NAMES)
  .sort((a, b) => b.length - a.length) // longest first so "New Mexico" beats "New"
  .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
// "<state> <zip>" with state as a full name or 2-letter code, ZIP not required
// to be at line end (contact blocks often trail an email/phone after it).
const STATE_ZIP = new RegExp(`\\b(${FULL_NAME_ALT}|[A-Za-z]{2})\\s*,?\\s*(\\d{5})(?:-\\d{4})?(?![\\d-])`, "i");

function resolveState(raw: string): string {
  const code = NAME_TO_CODE.get(raw.toLowerCase());
  if (code) return code;
  const up = raw.toUpperCase();
  return VALID_STATES.has(up) ? up : "";
}

// Street-name suffixes used to strip a street off a line so only the city
// remains. Matched case-insensitively, optional trailing period.
const STREET_SUFFIX =
  /^(st|street|rd|road|ave|avenue|blvd|boulevard|dr|drive|ln|lane|ct|court|cir|circle|way|pkwy|parkway|hwy|highway|pl|place|ter|terrace|trl|trail|box|pike|sq|loop|run|row|path|pass)\.?$/i;

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#0?38;/g, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/ /g, " ");
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
  const cityTokens = cut >= 0 ? tokens.slice(cut + 1) : tokens.slice();

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
 * Extract town + state from address lines. Handles the format variants seen in
 * the source contact blocks:
 *   "City, ST ZIP"          "City ST ZIP"
 *   "City, ST, ZIP"         "City ST, ZIP"
 *   "Street, City ST ZIP"   "Street City ST, ZIP"   lowercase state ("Pa")
 * Returns town="" when no parseable "...ST ZIP" line exists.
 */
export function extractTownState(lines: string[]): { town: string; state: string } {
  for (const line of lines) {
    if (!/\d{5}/.test(line)) continue;
    const m = STATE_ZIP.exec(line);
    if (!m) continue;
    const state = resolveState(m[1]!);
    if (!state) continue;

    // Everything before the state, minus a trailing comma (so "City, State"
    // and "City State" both leave just the city).
    const prefix = line.slice(0, m.index).replace(/[,\s]+$/, "");
    // The city is the last comma-separated segment (drops "Street," etc.).
    const seg = prefix.split(",").pop()!.trim();
    const town = cityFromSegment(seg);
    if (town) return { town, state };
  }
  return { town: "", state: "" };
}
