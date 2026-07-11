import crypto from "node:crypto";

/**
 * Hash de senha usando scrypt.
 * Formato armazenado: scrypt$<saltB64>$<hashB64>
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${Buffer.from(hash).toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [alg, saltB64, hashB64] = parts;
  if (alg !== "scrypt") return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(Buffer.from(actual), expected);
}

export function isValidLoginId(value: string): boolean {
  const v = value.trim();
  if (v.length < 3 || v.length > 64) return false;
  // permite letras, números e separadores comuns, incluindo ';' como no exemplo do usuário
  return /^[A-Za-z0-9;._-]+$/.test(v);
}


export function isValidLoginIdOrEmail(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.length < 3 || v.length > 128) return false;
  if (v.includes("@")) {
    // validação simples de e-mail (sem espaços, um @ e um domínio com ponto)
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }
  return isValidLoginId(v);
}

export function isValidPassword(value: string): boolean {
  const v = value.trim();
  if (v.length < 4 || v.length > 128) return false;
  return /^[A-Za-z0-9;._-]+$/.test(v);
}
