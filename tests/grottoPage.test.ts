import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { parseGrottoPage, pickWebsite } from "../scripts/src/pipeline/grottoPage.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, "fixtures", name), "utf8");

const utg = fixture("page-ut-grotto.html");
const bham = fixture("page-birmingham-grotto.html");
const dfw = fixture("page-dallas-fort-worth-grotto.html");

describe("parseGrottoPage", () => {
  it("extracts the town (town-level only) from UT Grotto's contact block", () => {
    // The page lists a member home address: "14045 North Green Hills Loop,
    // Austin, TX 78737-8619". We must get Austin, never the street.
    const r = parseGrottoPage(utg, "TX");
    expect(r.town).toBe("Austin");
    expect(r.state).toBe("TX");
  });

  it("PRIVACY: never returns the member's street in the town", () => {
    const r = parseGrottoPage(utg, "TX");
    expect(r.town).not.toMatch(/\d/);
    expect(r.town.toLowerCase()).not.toContain("green hills");
    expect(r.town.toLowerCase()).not.toContain("loop");
  });

  it("extracts town and the club website for Birmingham Grotto", () => {
    const r = parseGrottoPage(bham, "AL");
    expect(r.town).toBe("Birmingham");
    expect(r.state).toBe("AL");
    expect(r.website).toBe("https://www.bhamgrotto.org");
  });

  it("does NOT pick up the NSS HQ footer address on an address-less page", () => {
    // Dallas-Fort Worth lists only an email; the page footer has the NSS HQ
    // address (Huntsville, AL). We must return no town, not Huntsville.
    const r = parseGrottoPage(dfw, "TX");
    expect(r.town).toBe("");
    expect(r.state).toBe("TX");
  });

  it("falls back to the given state when the page has no parseable address", () => {
    expect(parseGrottoPage("<html><body>No address here</body></html>", "WY")).toMatchObject({
      town: "",
      state: "WY",
    });
  });
});

describe("pickWebsite", () => {
  it("returns the club site, not NSS's own social accounts", () => {
    const html = `
      <a href="https://twitter.com/NSScaves">x</a>
      <a href="https://www.facebook.com/NationalSpeleologicalSociety">fb</a>
      <a href="https://gmpg.org/xfn/11">boilerplate</a>
      <a href="https://caves.org/grotto/foo/">self</a>
      <a href="https://www.example-grotto.org">club</a>`;
    expect(pickWebsite(html)).toBe("https://www.example-grotto.org");
  });

  it("returns null when only NSS/boilerplate links exist", () => {
    const html = `
      <a href="https://instagram.com/nsscaves/">ig</a>
      <a href="https://caves.org/x/">self</a>
      <a href="https://gmpg.org/xfn/11">b</a>`;
    expect(pickWebsite(html)).toBeNull();
  });

  it("picks a club's caves.org SUBDOMAIN over the apex page and NSS infra", () => {
    // Many grottos are hosted at <grotto>.caves.org; that's a real club site.
    // The apex caves.org/grotto/ page and members.caves.org (NSS membership/
    // store, on every page) must NOT be chosen.
    const html = `
      <a href="https://members.caves.org/store/">store</a>
      <a href="https://caves.org/grotto/oregon-high-desert-grotto/">directory</a>
      <a href="https://ohdgrotto.caves.org/">club site</a>`;
    expect(pickWebsite(html)).toBe("https://ohdgrotto.caves.org/");
  });
});
