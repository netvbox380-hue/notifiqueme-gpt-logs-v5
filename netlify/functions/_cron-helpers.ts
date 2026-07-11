export function resolveSiteBaseUrl(explicitUrl?: string | null) {
  const candidates = [
    explicitUrl,
    process.env.URL,
    process.env.DEPLOY_URL,
    process.env.DEPLOY_PRIME_URL,
    process.env.NETLIFY_SITE_URL,
    process.env.SITE_URL,
    process.env.APP_URL,
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  const first = candidates.find((v) => /^https?:\/\//i.test(v));
  return first ? first.replace(/\/$/, "") : "";
}
