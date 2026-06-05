// App entry: load grottos.geojson, wire the map and the "nearest to me" UI.

import "./styles.css";
import { createMap } from "./map.js";
import {
  featuresToPoints,
  nearest,
  kmToMiles,
  type GrottoPoint,
  type LatLng,
} from "./geo.js";

const NEAREST_COUNT = 5;

const els = {
  status: document.getElementById("status") as HTMLParagraphElement,
  locateBtn: document.getElementById("locate-btn") as HTMLButtonElement,
  placeForm: document.getElementById("place-form") as HTMLFormElement,
  placeInput: document.getElementById("place-input") as HTMLInputElement,
  regionSelect: document.getElementById("region-select") as HTMLSelectElement,
  nearestPanel: document.getElementById("nearest-panel") as HTMLElement,
  nearestList: document.getElementById("nearest-list") as HTMLOListElement,
};

function setStatus(msg: string): void {
  els.status.textContent = msg;
}

/** Filter the full set by the selected region (empty = all). */
function visiblePoints(all: GrottoPoint[], region: string): GrottoPoint[] {
  return region ? all.filter((g) => g.region === region) : all;
}

function renderNearestList(grottoMap: ReturnType<typeof createMap>, points: GrottoPoint[]): void {
  els.nearestList.replaceChildren();
  for (const g of points) {
    const li = document.createElement("li");
    const miles = g.distanceKm !== undefined ? ` — ${kmToMiles(g.distanceKm).toFixed(0)} mi` : "";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nearest-item";
    btn.textContent = `${g.name} (${g.town}, ${g.state})${miles}`;
    btn.addEventListener("click", () => grottoMap.focus(g.name));
    li.appendChild(btn);
    els.nearestList.appendChild(li);
  }
  els.nearestPanel.hidden = points.length === 0;
}

/** Geocode a user-entered ZIP or "Town, ST" via Nominatim (client-side). */
async function geocodeQuery(query: string): Promise<LatLng | null> {
  const isZip = /^\d{5}$/.test(query.trim());
  const params = new URLSearchParams({
    format: "json",
    limit: "1",
    countrycodes: "us",
    ...(isZip ? { postalcode: query.trim() } : { q: `${query.trim()}, USA` }),
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "Accept-Language": "en" },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as Array<{ lat: string; lon: string }>;
  const hit = body[0];
  if (!hit) return null;
  return { lat: Number(hit.lat), lng: Number(hit.lon) };
}

async function main(): Promise<void> {
  const grottoMap = createMap("map");

  let all: GrottoPoint[] = [];
  try {
    const res = await fetch("grottos.geojson");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    all = featuresToPoints(await res.json());
  } catch (err) {
    setStatus("Could not load grotto data. Please try again later.");
    return;
  }

  // Populate the region filter from the data.
  const regions = [...new Set(all.map((g) => g.region))].sort();
  for (const r of regions) {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = r;
    els.regionSelect.appendChild(opt);
  }

  let origin: LatLng | null = null;

  function refresh(): void {
    const points = visiblePoints(all, els.regionSelect.value);
    grottoMap.render(points);
    if (origin) {
      const near = nearest(origin, points, NEAREST_COUNT);
      renderNearestList(grottoMap, near);
      grottoMap.fitTo(near);
    }
  }

  function locateTo(point: LatLng, label: string): void {
    origin = point;
    grottoMap.setUser(point.lat, point.lng);
    const points = visiblePoints(all, els.regionSelect.value);
    const near = nearest(point, points, NEAREST_COUNT);
    renderNearestList(grottoMap, near);
    grottoMap.fitTo(near);
    const closest = near[0];
    setStatus(
      closest
        ? `Nearest to ${label}: ${closest.name} in ${closest.town}, ${closest.state} (~${kmToMiles(closest.distanceKm!).toFixed(0)} mi).`
        : `No grottos found for ${label}.`
    );
  }

  setStatus(`${all.length} grottos loaded. Use your location or enter a ZIP / Town, ST.`);
  grottoMap.render(all);

  els.regionSelect.addEventListener("change", refresh);

  els.locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      setStatus("Geolocation is not available — enter a ZIP or Town, ST instead.");
      return;
    }
    setStatus("Locating you…");
    navigator.geolocation.getCurrentPosition(
      (pos) => locateTo({ lat: pos.coords.latitude, lng: pos.coords.longitude }, "you"),
      () => setStatus("Location denied — enter a ZIP or Town, ST instead."),
      { enableHighAccuracy: false, timeout: 10000 }
    );
  });

  els.placeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const query = els.placeInput.value.trim();
    if (!query) return;
    setStatus(`Searching for "${query}"…`);
    const point = await geocodeQuery(query);
    if (!point) {
      setStatus(`Couldn't find "${query}". Try a 5-digit ZIP or "Town, ST".`);
      return;
    }
    locateTo(point, query);
  });
}

void main();
