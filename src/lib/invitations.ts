import { roomCode } from "./validation";
export function validatePublicOrigin(value: string, production: boolean) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("APP_ORIGIN_INVALID");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (production &&
      (url.protocol !== "https:" ||
        url.hostname === "localhost" ||
        url.hostname === "[::1]" ||
        /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)))
  )
    throw new Error("APP_ORIGIN_INVALID");
  return url.origin;
}
export function invitationUrl(origin: string, code: string) {
  return `${validatePublicOrigin(origin, false)}/join/${roomCode.parse(code)}`;
}
