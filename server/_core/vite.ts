import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer, type InlineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const clientDir = path.resolve(rootDir, "client");

export async function setupVite(app: Express, server: Server) {
  const viteConfig: InlineConfig = {
    configFile: path.resolve(clientDir, "vite.config.ts"),
    server: {
      middlewareMode: true,
      hmr: { server },
      allowedHosts: true as const,
    },
    appType: "custom",
  };

  const vite = await createViteServer(viteConfig);

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    // Skip API routes
    if (url.startsWith("/api")) {
      return next();
    }

    try {
      const clientTemplate = path.resolve(clientDir, "index.html");

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(rootDir, "dist", "public");
  const indexPath = path.join(distPath, "index.html");

  console.log("Caminho de arquivos estáticos:", distPath);

  if (!fs.existsSync(distPath) || !fs.existsSync(indexPath)) {
    console.warn("⚠️  AVISO: Build do frontend não encontrado em:", distPath);
    console.warn("Certifique-se de rodar 'npm run build' antes de iniciar em modo produção.");
    
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.status(404).send(`
        <div style="font-family: sans-serif; padding: 20px; text-align: center;">
          <h1>Build não encontrado</h1>
          <p>O servidor está em modo produção, mas os arquivos do frontend não foram gerados.</p>
          <p>Execute <code>npm run build</code> para gerar os arquivos ou <code>npm run dev</code> para desenvolvimento.</p>
        </div>
      `);
    });
    return;
  }

  app.use(express.static(distPath));

  app.use("*", (req, res, next) => {
    if (req.originalUrl.startsWith("/api")) return next();
    res.sendFile(indexPath);
  });
}
