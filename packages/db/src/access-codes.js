import { createHash, randomBytes } from "node:crypto";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateAccessCode(length = 6) {
  let code = "";
  const bytes = randomBytes(length);
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return code;
}

export function hashAccessCode(code, pepper = process.env.ACCESS_CODE_PEPPER || "") {
  if (!code) throw new Error("Access code is required");
  return createHash("sha256")
    .update(`${String(code).trim().toUpperCase()}:${pepper}`)
    .digest("hex");
}

export function previewAccessCode(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (normalized.length <= 2) return normalized;
  return `${normalized.slice(0, 2)}****`;
}

