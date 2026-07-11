// server/storage.ts
import { ENV } from "./_core/env";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "fs";
import path from "path";

/* ============================
   NETLIFY
============================ */
const isNetlify =
  Boolean(process.env.NETLIFY) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
const isRender =
  Boolean(process.env.RENDER) ||
  Boolean(process.env.RENDER_SERVICE_ID) ||
  Boolean(process.env.RENDER_EXTERNAL_URL);

// somente /tmp é gravável no Netlify
const publicDir = path.resolve(process.cwd(), "dist", "public");
const configuredUploadsDir = (process.env.UPLOADS_DIR || "").trim();

const uploadsDir = configuredUploadsDir
  ? path.resolve(configuredUploadsDir)
  : isNetlify
    ? path.join("/tmp", "uploads")
    : path.join(publicDir, "uploads");

/* ============================
   🔥 AWS (SOMENTE MY_AWS_*)
============================ */
const ACCESS_KEY_ID = (process.env.MY_AWS_ACCESS_KEY_ID || "").trim();
const SECRET_ACCESS_KEY = (process.env.MY_AWS_SECRET_ACCESS_KEY || "").trim();
const REGION = (process.env.MY_AWS_REGION || "").trim();
const BUCKET = (process.env.MY_AWS_BUCKET || "").trim();

/* ============================
   LOG BOOT (diagnóstico)
============================ */
console.log("[STORAGE BOOT]", {
  isNetlify,
  isRender,
  uploadsDir,
  nodeEnv: ENV.nodeEnv,
  aws: {
    hasKey: Boolean(ACCESS_KEY_ID),
    hasSecret: Boolean(SECRET_ACCESS_KEY),
    hasRegion: Boolean(REGION),
    hasBucket: Boolean(BUCKET),
  },
});

/* ============================
   CONFIG
============================ */
export function getStorageMode(): "local" | "s3" {
  if (ACCESS_KEY_ID && SECRET_ACCESS_KEY && REGION && BUCKET) return "s3";
  return "local";
}

function makeS3Client() {
  return new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
    },
  });
}

/* ============================
   HELPERS
============================ */
function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function normalizeKey(relKey: string): string {
  const key = relKey.replace(/^\/+/, "");
  if (key.includes("..")) throw new Error("Invalid storage key");
  return key;
}

function localAbsolutePathForKey(key: string): string {
  return path.join(uploadsDir, key.replace(/^uploads\//, ""));
}

function localPublicUrlForKey(key: string): string {
  if (isNetlify) return `/uploads-unavailable/${encodeURIComponent(key)}`;

  const clean = key.startsWith("uploads/") ? key.slice("uploads/".length) : key;
  return `/uploads/${clean}`;
}

function toBuffer(data: Buffer | Uint8Array | string): Buffer {
  return data instanceof Buffer
    ? data
    : data instanceof Uint8Array
      ? Buffer.from(data)
      : Buffer.from(data, "utf8");
}

/* ============================
   PUT
============================ */
export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const mode = getStorageMode();

  console.log("[STORAGE PUT]", { key, mode });

  if (mode === "local") {
    ensureDir(uploadsDir);
    const abs = localAbsolutePathForKey(key);
    ensureDir(path.dirname(abs));
    fs.writeFileSync(abs, toBuffer(data));
    return { key, url: localPublicUrlForKey(key) };
  }

  const s3 = makeS3Client();
  try {

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: toBuffer(data),
        ContentType: contentType,
      })
    );

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: 3600 }
    );

    console.log("[STORAGE PUT OK]", { key });

    return { key, url };
  } finally {
    try { s3.destroy(); } catch {}
  }

}

/* ============================
   PRESIGNED PUT (direct upload)
   - Evita limites de payload do Netlify/Express/Netlify CLI
============================ */
export async function storageCreatePutUrl(
  relKey: string,
  contentType = "application/octet-stream",
  expiresInSeconds = 900
): Promise<{ key: string; putUrl: string }> {
  const key = normalizeKey(relKey);
  const mode = getStorageMode();

  if (mode === "local") {
    // No modo local, o upload é feito via filesystem em storagePut().
    throw new Error("Presigned PUT não suportado no modo local");
  }

  const s3 = makeS3Client();
  try {

    const putUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: expiresInSeconds }
    );

    return { key, putUrl };
  } finally {
    try { s3.destroy(); } catch {}
  }

}

/* ============================
   GET
============================ */
export async function storageGet(
  relKey: string
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const mode = getStorageMode();

  console.log("[STORAGE GET]", { key, mode });

  if (mode === "local") {
    return { key, url: localPublicUrlForKey(key) };
  }

  const s3 = makeS3Client();
  try {

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: 3600 }
    );

    console.log("[STORAGE GET OK]", { key });

    return { key, url };
  } finally {
    try { s3.destroy(); } catch {}
  }

}

/* ============================
   DELETE
============================ */
export async function storageDelete(relKey: string): Promise<void> {
  const key = normalizeKey(relKey);
  const mode = getStorageMode();

  console.log("[STORAGE DELETE]", { key, mode });

  if (mode === "local") {
    const abs = localAbsolutePathForKey(key);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
    return;
  }

  const s3 = makeS3Client();
  try {

    await s3.send(
      new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: key,
      })
    );

    console.log("[STORAGE DELETE OK]", { key });
  } finally {
    try { s3.destroy(); } catch {}
  }

}

export const LOCAL_UPLOADS_DIR = uploadsDir;
export const STORAGE_PUBLIC_DIR = publicDir;
