import { describe, it, expect } from "vitest";
import { haversineKm, kmToMiles, nearest, featuresToPoints } from "../src/geo.js";

describe("haversineKm", () => {
  it("is ~0 for identical points", () => {
    expect(haversineKm({ lat: 34.7, lng: -86.6 }, { lat: 34.7, lng: -86.6 })).toBeCloseTo(0, 5);
  });

  it("matches a known distance (Huntsville AL -> Birmingham AL ~ 130 km)", () => {
    const d = haversineKm({ lat: 34.7304, lng: -86.586 }, { lat: 33.5186, lng: -86.8104 });
    expect(d).toBeGreaterThan(120);
    expect(d).toBeLessThan(145);
  });

  it("kmToMiles converts correctly", () => {
    expect(kmToMiles(100)).toBeCloseTo(62.137, 2);
  });
});

const POINTS = [
  { name: "Far", region: "X", town: "", state: "", contact_url: null, last_seen: "", lat: 40, lng: -100 },
  { name: "Near", region: "X", town: "", state: "", contact_url: null, last_seen: "", lat: 34.8, lng: -86.6 },
  { name: "Mid", region: "Y", town: "", state: "", contact_url: null, last_seen: "", lat: 36, lng: -90 },
];

describe("nearest", () => {
  const origin = { lat: 34.7, lng: -86.6 };

  it("sorts nearest-first and annotates distanceKm", () => {
    const result = nearest(origin, POINTS);
    expect(result.map((g) => g.name)).toEqual(["Near", "Mid", "Far"]);
    expect(result[0]!.distanceKm).toBeGreaterThanOrEqual(0);
    expect(result[0]!.distanceKm!).toBeLessThan(result[1]!.distanceKm!);
  });

  it("respects the limit", () => {
    expect(nearest(origin, POINTS, 2)).toHaveLength(2);
  });
});

describe("featuresToPoints", () => {
  it("parses valid features and skips invalid ones", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-86.6, 34.7] },
          properties: { name: "Good", region: "TAG", town: "Huntsville", state: "AL", contact_url: null, last_seen: "2026-06-05" },
        },
        { type: "Feature", geometry: { type: "Point", coordinates: [-86.6, 34.7] }, properties: {} }, // no name
        { type: "Feature", geometry: {}, properties: { name: "NoCoords" } }, // no coords
      ],
    };
    const points = featuresToPoints(fc);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ name: "Good", town: "Huntsville", lat: 34.7, lng: -86.6 });
  });
});
