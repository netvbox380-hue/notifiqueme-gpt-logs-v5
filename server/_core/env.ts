// server/_core/env.ts
import "dotenv/config";

function required(
  name: string,
  value: string | undefined | null,
  { fatal }: { fatal: boolean }
) {
  const v = (value ?? "").trim();
  if (!v) {
    const msg = `[ENV] ${fatal ? "❌" : "⚠️"} ${name} não está definido.`;
    if (fatal) console.error(msg);
    else console.warn(msg);
  }
  return v;
}

function normalizeUrl(u: string) {
  const t = (u || "").trim();
  return t.replace(/\/$/, "");
}

/** 🔐 Log seguro: não mostra valor, só presença e tamanho */
function present(v?: string | null) {
  return v ? `yes(len=${String(v).length})` : "no";
}

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";

const isNetlify =
  Boolean(process.env.NETLIFY) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
const isAwsLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

// ✅ Segredos (compatível com versões antigas e novas)
const cookieSecret = (process.env.COOKIE_SECRET || process.env.JWT_SECRET || "").trim();
const jwtSecret = (process.env.JWT_SECRET || process.env.COOKIE_SECRET || "").trim();

/**
 * ✅ sessionSecret (o SDK novo usa isso)
 * Prioridade:
 * 1) SESSION_SECRET (novo padrão)
 * 2) JWT_SECRET
 * 3) COOKIE_SECRET (fallback)
 */
const sessionSecret = (
  process.env.SESSION_SECRET ||
  process.env.JWT_SECRET ||
  process.env.COOKIE_SECRET ||
  ""
).trim();

const appUrl = normalizeUrl(process.env.APP_URL || "");
const sessionCookieName = (process.env.SESSION_COOKIE_NAME || "app_session_id").trim();

// ✅ Web Push (VAPID)
const vapidPublicKey = (process.env.VAPID_PUBLIC_KEY || "").trim();
const vapidPrivateKey = (process.env.VAPID_PRIVATE_KEY || "").trim();
const vapidSubject = (process.env.VAPID_SUBJECT || "").trim();

// ✅ proteção opcional para endpoints de CRON (ex: system.runSchedules)
const cronSecret = (process.env.CRON_SECRET || "").trim();

/* =========================================================
   ✅ AWS/S3 (SOMENTE MY_AWS_* como você pediu)
   - Não usa AWS_* nem S3_* para evitar conflito no Netlify.
   - Se faltar, storage.ts cai em modo local.
========================================================= */
const myAwsAccessKeyId = (process.env.MY_AWS_ACCESS_KEY_ID || "").trim();
const myAwsSecretAccessKey = (process.env.MY_AWS_SECRET_ACCESS_KEY || "").trim();
const myAwsRegion = (process.env.MY_AWS_REGION || "").trim();
const myAwsBucket = (process.env.MY_AWS_BUCKET || "").trim();

// endpoint custom (minio/r2/etc) opcional — também no padrão MY_AWS
const myAwsS3Endpoint = (process.env.MY_AWS_S3_ENDPOINT || "").trim();

export const ENV = {
  nodeEnv,
  isProduction,

  // ambiente
  isNetlify,
  isAwsLambda,

  port: parseInt(process.env.PORT || "10000", 10),
  host: process.env.HOST || "0.0.0.0",

  appId: process.env.APP_ID || process.env.VITE_APP_ID || "notifique-me",
  appUrl,

  // push
  vapidPublicKey,
  vapidPrivateKey,
  vapidSubject,

  // cron
  cronSecret,

  // auth/secrets
  cookieSecret,
  jwtSecret,
  sessionSecret,

  databaseUrl: (process.env.DATABASE_URL || "").trim(),
  sessionCookieName,

  ownerOpenId: (process.env.OWNER_OPEN_ID || "").trim(),
  ownerPassword: (process.env.OWNER_PASSWORD || "").trim(),

  oAuthServerUrl: (process.env.OAUTH_SERVER_URL || "").trim(),

  forgeApiUrl: (process.env.BUILT_IN_FORGE_API_URL || "").trim(),
  forgeApiKey: (process.env.BUILT_IN_FORGE_API_KEY || "").trim(),

  // ✅ AWS/S3 MY_AWS_*
  myAwsAccessKeyId,
  myAwsSecretAccessKey,
  myAwsRegion,
  myAwsBucket,
  myAwsS3Endpoint,

  // aliases antigos mantidos
  COOKIE_SECRET: cookieSecret,
  APP_URL: appUrl,
} as const;

// ==============================
// LOGS SEGUROS (DEV e PROD)
// ==============================
const envSnapshot = {
  nodeEnv: ENV.nodeEnv,
  isProduction: ENV.isProduction,
  isNetlify: ENV.isNetlify,
  isAwsLambda: ENV.isAwsLambda,
  port: ENV.port,
  appUrl: ENV.appUrl ? ENV.appUrl : "(vazio)",

  databaseUrl: ENV.databaseUrl ? "yes" : "no",

  // secrets
  sessionSecret: present(ENV.sessionSecret),
  jwtSecret: present(ENV.jwtSecret),
  cookieSecret: present(ENV.cookieSecret),

  // vapid
  vapidPublicKey: present(ENV.vapidPublicKey),
  vapidPrivateKey: present(ENV.vapidPrivateKey),
  vapidSubject: present(ENV.vapidSubject),

  // aws/s3 (MY_AWS)
  myAwsRegion: ENV.myAwsRegion ? ENV.myAwsRegion : "(vazio)",
  myAwsBucket: ENV.myAwsBucket ? ENV.myAwsBucket : "(vazio)",
  myAwsAccessKeyId: present(ENV.myAwsAccessKeyId),
  myAwsSecretAccessKey: ENV.myAwsSecretAccessKey ? "yes" : "no",
  myAwsS3Endpoint: ENV.myAwsS3Endpoint ? "(set)" : "(none)",
};

if (!ENV.isProduction) {
  console.log("[ENV] Configuração carregada (dev):", envSnapshot);
} else {
  console.log("[ENV] Loaded (prod safe):", envSnapshot);
}

// ==============================
// VALIDAÇÕES CRÍTICAS
// ==============================
required("DATABASE_URL", ENV.databaseUrl, { fatal: ENV.isProduction });

// ✅ pelo menos UM segredo tem que existir
required("SESSION_SECRET (ou JWT_SECRET/COOKIE_SECRET)", ENV.sessionSecret, {
  fatal: ENV.isProduction,
});

// mantém compatibilidade com seus logs/validações antigas
required("COOKIE_SECRET (ou JWT_SECRET)", ENV.cookieSecret, { fatal: false });
required("JWT_SECRET", ENV.jwtSecret, { fatal: false });

// ✅ Exigir Web Push em produção
required("VAPID_PUBLIC_KEY", vapidPublicKey, { fatal: ENV.isProduction });
required("VAPID_PRIVATE_KEY", vapidPrivateKey, { fatal: ENV.isProduction });
required("VAPID_SUBJECT", vapidSubject, { fatal: ENV.isProduction });

// CRON opcional (mas recomendado em produção)
required("CRON_SECRET", cronSecret, { fatal: false });

// OWNER opcional
required("OWNER_OPEN_ID", ENV.ownerOpenId, { fatal: false });

// ✅ AWS/S3: não fatal por padrão (porque você pode rodar em modo local)
// Mas loga para diagnosticar mídia quebrada.
if (ENV.isProduction) {
  if (!ENV.myAwsBucket || !ENV.myAwsRegion) {
    console.warn("[ENV] ⚠️ MY_AWS S3 pode não estar configurado (bucket/region ausentes).");
  }
  if (!ENV.myAwsAccessKeyId || !ENV.myAwsSecretAccessKey) {
    console.warn("[ENV] ⚠️ Credenciais MY_AWS podem estar ausentes (ACCESS_KEY/SECRET).");
  }
}
