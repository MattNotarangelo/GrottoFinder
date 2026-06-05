// Leaflet map setup and marker rendering. Keeps Leaflet specifics out of
// main.ts. Every grotto is shown as its own marker at all zoom levels (no
// clustering).

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GrottoPoint } from "./geo.js";

// Continental-US default view.
const US_CENTER: L.LatLngTuple = [39.5, -98.35];
const US_ZOOM = 4;

export interface GrottoMap {
  map: L.Map;
  /** Replace all grotto markers with the given set. */
  render(points: GrottoPoint[]): void;
  /** Place/replace the "you are here" marker. */
  setUser(lat: number, lng: number): void;
  /** Fit the view to the given points (plus the user marker if set). */
  fitTo(points: GrottoPoint[]): void;
  /** Open the popup for a specific grotto by name. */
  focus(name: string): void;
}

function popupHtml(g: GrottoPoint): string {
  const where = [g.town, g.state].filter(Boolean).join(", ");
  const linkLabel =
    g.contact_url && g.contact_url.toLowerCase().includes("caves.org")
      ? "View on caves.org"
      : "Visit website";
  const link = g.contact_url
    ? `<a href="${encodeURI(g.contact_url)}" target="_blank" rel="noopener noreferrer">${linkLabel}</a>`
    : `<span class="no-link">No website listed</span>`;
  // Escaped via textContent-style replacement to avoid injecting markup.
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `
    <div class="popup">
      <strong>${esc(g.name)}</strong><br />
      <span class="popup-where">${esc(where)}</span><br />
      <span class="popup-region">${esc(g.region)}</span><br />
      ${link}
    </div>`;
}

export function createMap(elementId: string): GrottoMap {
  const map = L.map(elementId).setView(US_CENTER, US_ZOOM);

  // CARTO "Positron" basemap: light/clean, free, no API key, OSM data. The
  // {r} token + detectRetina request @2x tiles on HiDPI displays so the map
  // stays sharp instead of upscaling 1x tiles.
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    detectRetina: true,
    subdomains: "abcd",
    attribution:
      '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);

  const grottoLayer = L.featureGroup().addTo(map);

  const markersByName = new Map<string, L.CircleMarker>();
  let userMarker: L.CircleMarker | null = null;

  function render(points: GrottoPoint[]): void {
    grottoLayer.clearLayers();
    markersByName.clear();
    for (const g of points) {
      const marker = L.circleMarker([g.lat, g.lng], {
        radius: 7,
        weight: 2,
        color: "#1b6b3a",
        fillColor: "#2e9e5b",
        fillOpacity: 0.85,
      }).bindPopup(popupHtml(g));
      markersByName.set(g.name, marker);
      grottoLayer.addLayer(marker);
    }
  }

  function setUser(lat: number, lng: number): void {
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.circleMarker([lat, lng], {
      radius: 9,
      weight: 3,
      color: "#1d4ed8",
      fillColor: "#3b82f6",
      fillOpacity: 0.9,
    })
      .bindPopup("You are here")
      .addTo(map);
  }

  function fitTo(points: GrottoPoint[]): void {
    const latlngs = points.map((g) => [g.lat, g.lng] as L.LatLngTuple);
    if (userMarker) latlngs.push([userMarker.getLatLng().lat, userMarker.getLatLng().lng]);
    if (latlngs.length === 0) return;
    map.fitBounds(L.latLngBounds(latlngs).pad(0.2), { maxZoom: 10 });
  }

  function focus(name: string): void {
    const marker = markersByName.get(name);
    if (!marker) return;
    const latlng = marker.getLatLng();
    map.setView(latlng, Math.max(map.getZoom(), 9), { animate: true });
    marker.openPopup();
  }

  return { map, render, setUser, fitTo, focus };
}
