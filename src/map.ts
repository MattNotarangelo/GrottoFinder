// Leaflet map setup, marker rendering, and clustering. Keeps Leaflet specifics
// out of main.ts.

import L from "leaflet";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
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
  const link = g.contact_url
    ? `<a href="${encodeURI(g.contact_url)}" target="_blank" rel="noopener noreferrer">Visit website</a>`
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

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const cluster = L.markerClusterGroup({ maxClusterRadius: 50 });
  map.addLayer(cluster);

  const markersByName = new Map<string, L.CircleMarker>();
  let userMarker: L.CircleMarker | null = null;

  function render(points: GrottoPoint[]): void {
    cluster.clearLayers();
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
      cluster.addLayer(marker);
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
    // zoomToShowLayer reveals a marker hidden inside a cluster, then opens it.
    cluster.zoomToShowLayer(marker, () => marker.openPopup());
  }

  return { map, render, setUser, fitTo, focus };
}
