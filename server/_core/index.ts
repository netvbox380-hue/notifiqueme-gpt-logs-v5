import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";

import { createApp } from "./app";
import { ENV } from "./env";
import { LOCAL_UPLOADS_DIR, getStorageMode } from "../storage";

/* ============================
   ✅ FIX __dirname (ESM + CJS/Netlify)
============================ */
const __filenameResolved =
  typeof __filename !== "undefined" ? __filename : fileURLToPath(import.meta.url);

const __dirnameResolved = path.dirname(__filenameResolved);

async function startServer() {
  const app = await createApp();
  const server = createServer(app);

  // ✅ Necessário para cookies funcionarem atrás do proxy (Render)
  app.set("trust proxy", 1);

  /* ============================
     FRONTEND ESTÁTICO (dist/public)
     (No Render, serve o build junto)
  ============================ */
  const publicPath = path.join(__dirnameResolved, "public");

  // ⚠️ Por padrão, express.static() IGNORA qualquer caminho com segmento iniciado
  // por "." (ex.: /.well-known/assetlinks.json), retornando 404 mesmo que o arquivo exista.
  // Isso quebraria a verificação "Digital Asset Links" exigida pelo Google Play para
  // o app Android (TWA) abrir sem a barra de endereço do navegador.
  // Rota explícita ANTES do static genérico, servindo com o content-type correto.
  app.use(
    "/.well-known",
    express.static(path.join(publicPath, ".well-known"), {
      dotfiles: "allow",
      setHeaders: (res) => res.setHeader("Content-Type", "application/json"),
    })
  );

  app.use(express.static(publicPath));

  if (getStorageMode() === "local") {
    app.use("/uploads", express.static(LOCAL_UPLOADS_DIR, { fallthrough: true, maxAge: ENV.isProduction ? "1h" : 0 }));
  }

  // SPA fallback
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api")) return next();
    if (req.path.startsWith("/oauth")) return next();
    if (req.path === "/healthz") return next();
    if (req.path.includes(".")) return next();
    return res.sendFile(path.join(publicPath, "index.html"));
  });

  console.log("🚀 Frontend estático habilitado");
  console.log("📁 Caminho do frontend:", publicPath);

  /* ============================
     START SERVER
  ============================ */
  const PORT = ENV.port;

  server.listen(PORT, ENV.host, () => {
    console.log("========================================");
    console.log("✅ Servidor rodando");
    console.log("🌐 Host:", ENV.host);
    console.log("🌐 Porta:", PORT);
    console.log("========================================");
  });
}

startServer().catch((err) => {
  console.error("❌ Erro ao iniciar servidor:", err);
  process.exit(1);
});
