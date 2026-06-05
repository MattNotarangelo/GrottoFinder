// Pure geo helpers — no DOM, unit-tested.

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GrottoProps {
  name: string;
  region: string;
  town: string;
  state: string;
  contact_url: string | null;
  last_seen: string;
}

/** A grotto with its coordinates and (once computed) distance from the user. */
export interface GrottoPoint extends GrottoProps, LatLng {
  distanceKm?: number;
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export const kmToMiles = (km: number): number => km * 0.621371;

/** Return grottos sorted nearest-first, each annotated with distanceKm. */
export function nearest(origin: LatLng, grottos: GrottoPoint[], limit = grottos.length): GrottoPoint[] {
  return grottos
    .map((g) => ({ ...g, distanceKm: haversineKm(origin, g) }))
    .sort((a, b) => a.distanceKm! - b.distanceKm!)
    .slice(0, limit);
}

/** Parse a GeoJSON FeatureCollection into GrottoPoints. Tolerates bad features. */
export function featuresToPoints(geojson: unknown): GrottoPoint[] {
  const fc = geojson as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: Partial<GrottoProps>;
    }>;
  };
  const out: GrottoPoint[] = [];
  for (const f of fc.features ?? []) {
    const coords = f.geometry?.coordinates;
    const p = f.properties;
    if (!coords || !p?.name) continue;
    const [lng, lat] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      name: p.name,
      region: p.region ?? "Other",
      town: p.town ?? "",
      state: p.state ?? "",
      contact_url: p.contact_url ?? null,
      last_seen: p.last_seen ?? "",
      lat,
      lng,
    });
  }
  return out;
}
