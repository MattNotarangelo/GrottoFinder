// Shared grotto-name normalization, used to match the API roster against the
// legacy list. The two sources spell the same club differently (e.g. "Spel.
// Society" vs "Speleological Society", "Troglodyte Soc" vs "Troglodyte
// Society"), so we expand common abbreviations and drop noise before comparing.

const ABBREVIATIONS: Record<string, string> = {
  spel: "speleological",
  soc: "society",
  gr: "grotto",
  univ: "university",
  u: "university",
  sch: "school",
  assn: "association",
  mtn: "mountain",
  natl: "national",
  org: "organization",
  stu: "student",
  reg: "regional",
  co: "county",
};

const STOPWORDS = new Set(["the", "of", "a", "for", "and"]);

/** Decode the handful of HTML entities that appear in source/API names. */
export function decodeName(s: string): string {
  return s
    .replace(/&#0?38;/g, "&")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize a grotto name into a comparison key: lowercase, entity-decoded,
 * parentheticals dropped, punctuation stripped, abbreviations expanded, and
 * stopwords removed. Two names that refer to the same club should produce the
 * same key.
 */
export function normalizeName(name: string): string {
  const decoded = decodeName(name).toLowerCase().replace(/&/g, " and ");
  const noParens = decoded.replace(/\(.*?\)/g, " ");
  const alnum = noParens.replace(/[^a-z0-9 ]/g, " ");
  const tokens = alnum
    .split(/\s+/)
    .map((t) => ABBREVIATIONS[t] ?? t)
    .filter((t) => t && !STOPWORDS.has(t));
  return tokens.join(" ").trim();
}
