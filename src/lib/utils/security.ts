import { createHash, randomBytes, randomInt } from "node:crypto";
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateCode() {
  return Array.from(
    { length: 6 },
    () => alphabet[randomInt(alphabet.length)],
  ).join("");
}
export function credential() {
  return randomBytes(32).toString("base64url");
}
export function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function cookieName(code: string) {
  return `qa_session_${code}`;
}
