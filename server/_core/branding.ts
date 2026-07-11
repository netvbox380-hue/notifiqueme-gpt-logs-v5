import { TRPCError } from "@trpc/server";

function trimToNull(value?: string | null) {
  const v = String(value ?? "").trim();
  return v ? v : null;
}

function normalizeUrl(value?: string | null) {
  const v = trimToNull(value);
  if (!v) return null;
  try {
    const url = new URL(v);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("invalid_protocol");
    }
    return url.toString();
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "URL inválida" });
  }
}

function normalizeColor(value?: string | null) {
  const v = trimToNull(value);
  if (!v) return null;
  const color = v.startsWith("#") ? v : `#${v}`;
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Cor principal inválida" });
  }
  return color.toUpperCase();
}

function normalizePhone(value?: string | null) {
  const v = trimToNull(value);
  if (!v) return null;
  return v.replace(/[^\d+()\-\s]/g, "").trim() || null;
}

export function sanitizeBrandingInput(input: {
  brandName?: string | null;
  brandLogoUrl?: string | null;
  brandPrimaryColor?: string | null;
  supportPhone?: string | null;
  pixKey?: string | null;
  mercadoPagoLink?: string | null;
}) {
  return {
    brandName: trimToNull(input.brandName),
    brandLogoUrl: input.brandLogoUrl === undefined ? undefined : normalizeUrl(input.brandLogoUrl),
    brandPrimaryColor: input.brandPrimaryColor === undefined ? undefined : normalizeColor(input.brandPrimaryColor),
    supportPhone: input.supportPhone === undefined ? undefined : normalizePhone(input.supportPhone),
    pixKey: input.pixKey === undefined ? undefined : trimToNull(input.pixKey),
    mercadoPagoLink: input.mercadoPagoLink === undefined ? undefined : normalizeUrl(input.mercadoPagoLink),
  };
}
