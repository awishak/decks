import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Library mode. React stays external so the host app supplies it and we do not
// ship a second copy into every consuming bundle.
export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: "src/index.js", name: "Decks", fileName: () => "decks.js", formats: ["es"] },
    rollupOptions: { external: ["react", "react-dom", "react/jsx-runtime"] },
  },
});
