// USPS state/territory codes and the NSS-region grouping used for the map's
// region filter.
//
// NOTE: the source list is organized by STATE, not by NSS region. The region
// here is DERIVED from the state via the documented map below. It is a coarse,
// human-friendly grouping (not an official NSS administrative boundary) and can
// be corrected per-grotto via data/overrides.json. See README "Regions".

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  // Territories / associated areas that appear in the source.
  AS: "American Samoa", GU: "Guam", MP: "Northern Mariana Islands",
  PR: "Puerto Rico", VI: "U.S. Virgin Islands",
};

export const VALID_STATES = new Set(Object.keys(STATE_NAMES));

/** State -> coarse caving region for the map's region filter. */
const STATE_TO_REGION: Record<string, string> = {
  // Northeast
  ME: "Northeast", NH: "Northeast", VT: "Northeast", MA: "Northeast",
  RI: "Northeast", CT: "Northeast", NY: "Northeast", NJ: "Northeast",
  PA: "Northeast",
  // Mid-Atlantic / Virginias (dense caving country)
  MD: "Mid-Atlantic", DE: "Mid-Atlantic", DC: "Mid-Atlantic",
  VA: "Mid-Atlantic", WV: "Mid-Atlantic",
  // Southeast / TAG (Tennessee-Alabama-Georgia) — the densest US caving region
  TN: "Southeast / TAG", AL: "Southeast / TAG", GA: "Southeast / TAG",
  KY: "Southeast / TAG", NC: "Southeast / TAG", SC: "Southeast / TAG",
  FL: "Southeast / TAG", MS: "Southeast / TAG",
  // Midwest
  OH: "Midwest", IN: "Midwest", IL: "Midwest", MI: "Midwest", WI: "Midwest",
  MN: "Midwest", IA: "Midwest", MO: "Midwest", KS: "Midwest", NE: "Midwest",
  ND: "Midwest", SD: "Midwest",
  // South Central
  TX: "South Central", OK: "South Central", AR: "South Central",
  LA: "South Central",
  // West / Mountain
  MT: "West", WY: "West", CO: "West", NM: "West", ID: "West", UT: "West",
  NV: "West", AZ: "West",
  // Pacific
  WA: "Pacific", OR: "Pacific", CA: "Pacific", AK: "Pacific", HI: "Pacific",
  // Territories
  AS: "Pacific", GU: "Pacific", MP: "Pacific", PR: "Other", VI: "Other",
};

export function regionForState(state: string): string {
  return STATE_TO_REGION[state] ?? "Other";
}
