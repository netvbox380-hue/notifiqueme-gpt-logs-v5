import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: __dirname,
  publicDir: path.resolve(__dirname, "public"),
  envDir: rootDir,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(rootDir, "shared"),
      "@assets": path.resolve(rootDir, "attached_assets"),
    },
  },
  build: {
    outDir: path.resolve(rootDir, "dist/public"),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    fs: {
      // ✅ Evita erro de allow list quando o Vite/Netlify Dev referencia caminhos absolutos antigos (cache)
      // (Windows) — permite servir arquivos dentro do diretório pai do projeto durante desenvolvimento.
      allow: [rootDir, path.resolve(rootDir, "..")],
    },
    port: 5173,
    // Netlify Dev (Windows) às vezes valida a porta via IPv6 (localhost -> ::1).
    // Escutar em "::" garante compatibilidade IPv4 + IPv6 sem depender do resolver.
    host: "::",
    strictPort: true,
    open: false,
    cors: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        secure: false,
      },
    },
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
});
