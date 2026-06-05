// Shared types for the grotto data pipeline.
//
// PRIVACY: We deliberately model ONLY club-level, town-level data. There is no
// field for street address, member name, or phone number, and the parser never
// extracts them. See README "Privacy & scope".

/** A grotto as extracted from the source HTML (pre-geocode). */
export interface ScrapedGrotto {
  /** Club name, e.g. "Huntsville Grotto". */
  name: string;
  /** Town / city, e.g. "Huntsville". Town-level only — never a street. */
  town: string;
  /** Two-letter USPS state/territory code, e.g. "AL". */
  state: string;
  /** Club website URL, or null if the source listed none. */
  contactUrl: string | null;
}

/** A geocoded coordinate plus which service produced it. */
export interface GeocodeResult {
  lat: number;
  lng: number;
  /** "census" | "nominatim" | "override" — provenance for debugging. */
  source: string;
}

/** Cache file shape: keyed by the exact geocoder input string. */
export type GeocodeCache = Record<string, GeocodeResult>;

/**
 * Hand-maintained corrections in data/overrides.json. Overrides ALWAYS win and
 * survive every re-scrape. Keyed by a stable grotto key (see grottoKey()).
 */
export interface Override {
  /** Drop this grotto entirely (e.g. defunct, duplicate). */
  exclude?: boolean;
  /** Correct the town when the source has a typo or wrong location. */
  town?: string;
  /** Correct the state code. */
  state?: string;
  /** Pin exact coordinates (still town-centroid level, never a home). */
  lat?: number;
  lng?: number;
  /** Fix the display name. */
  name?: string;
  /** Fix or set the club website. */
  contactUrl?: string | null;
  /** Free-text note for humans; ignored by the pipeline. */
  note?: string;
}

export type Overrides = Record<string, Override>;

/** Final emitted grotto record (becomes a GeoJSON feature's properties). */
export interface Grotto {
  name: string;
  region: string;
  town: string;
  state: string;
  contact_url: string | null;
  lat: number;
  lng: number;
  /** ISO date (YYYY-MM-DD) this grotto was last seen in the source. */
  last_seen: string;
}
