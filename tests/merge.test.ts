import { describe, it, expect } from "vitest";
import { merge } from "../scripts/src/pipeline/merge.js";
import type { ScrapedGrotto, GeocodeCache, Overrides } from "../scripts/src/pipeline/types.js";

const cache: GeocodeCache = {
  "Austin, TX": { lat: 30.27, lng: -97.74, source: "test" },
  "McKeesport, PA": { lat: 40.35, lng: -79.86, source: "test" },
};
const scraped: ScrapedGrotto[] = [
  { name: "UT Grotto", town: "Austin", state: "TX", contactUrl: "http://page-found.example" },
  { name: "Pittsburgh Grotto", town: "", state: "PA", contactUrl: "http://www.pittsburghcaving.club" },
  { name: "No Town Grotto", town: "", state: "GA", contactUrl: null },
];

describe("merge applies overrides", () => {
  it("contact_url override wins over the scraped/page URL", () => {
    const overrides: Overrides = {
      "Pittsburgh Grotto": { town: "McKeesport", state: "PA", contact_url: "https://pghgrotto.com/Home" },
    };
    const out = merge(scraped, cache, overrides, "2026-06-05");
    const pgh = out.grottos.find((g) => g.name === "Pittsburgh Grotto");
    expect(pgh?.contact_url).toBe("https://pghgrotto.com/Home"); // not pittsburghcaving.club
    expect(pgh).toMatchObject({ town: "McKeesport", state: "PA" });
  });

  it("keeps the scraped URL when no contact_url override is given", () => {
    const out = merge(scraped, cache, {}, "2026-06-05");
    expect(out.grottos.find((g) => g.name === "UT Grotto")?.contact_url).toBe("http://page-found.example");
  });

  it("leaves a grotto unplaced when it has no town and no coord override", () => {
    const out = merge(scraped, cache, {}, "2026-06-05");
    expect(out.unplaced).toContain("No Town Grotto");
    expect(out.grottos.some((g) => g.name === "No Town Grotto")).toBe(false);
  });
});
