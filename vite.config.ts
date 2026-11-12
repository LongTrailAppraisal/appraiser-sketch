import { defineConfig } from "vite";

// Relative base so the build works from GitHub Pages or a local folder.
// A fixed port: the browser keeps drafts, My labels and settings per address,
// so the app must always open at the same one (http://localhost:5179).
export default defineConfig({
  base: "./",
  server: { port: 5179, strictPort: true, open: true },
  preview: { port: 5179, strictPort: true, open: true },
});
