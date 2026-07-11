import type { Handler } from "@netlify/functions";
import serverless from "serverless-http";
import { createApp } from "../../server/_core/app";

/**
 * ✅ BOOT LOG: prova que a function nova subiu e está rodando
 * (não mostra segredos)
 */
console.log("[BOOT] api function loaded", {
  hasBucket: !!process.env.S3_BUCKET,
  hasKeyId: !!(process.env.S3_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY),
  hasSecret: !!(process.env.S3_SECRET_ACCESS_KEY || process.env.S3_SECRET_KEY),
  region: process.env.S3_REGION,
  isNetlify: !!(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME),
});

/**
 * ✅ Força executar server/storage.ts na inicialização
 * pra aparecer o console.log("[S3 CHECK] ...") dele.
 */
import "../../server/storage";

let cached: any;

async function getServerlessHandler() {
  if (cached) return cached;

  const app = await createApp();

  // Importante: strip do prefixo do Netlify Functions
  cached = serverless(app, { basePath: "/.netlify/functions/api" });
  return cached;
}

export const handler: Handler = async (event, context) => {
  const h = await getServerlessHandler();
  return h(event, context);
};

