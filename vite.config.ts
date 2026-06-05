import { defineConfig } from "vite";

// Static site. `public/` (incl. grottos.geojson) is copied to the build output
// as-is, so the app fetches "grottos.geojson" at the site root.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
