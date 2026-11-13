import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { invitationUrl, validatePublicOrigin } from "../src/lib/invitations";
import { configuredOrigin } from "../src/lib/public-origin";
import { sameOrigin } from "../src/lib/services/http";
const seen = vi.hoisted(() => ({ qr: "", copy: "" }));
vi.mock("qrcode.react", () => ({
  QRCodeSVG: (p: { value: string }) => {
    seen.qr = p.value;
    return null;
  },
}));
vi.mock("../src/features/lobby/room-code", () => ({
  RoomCode: (p: { invite: string }) => {
    seen.copy = p.invite;
    return null;
  },
}));
import { Invitation } from "../src/features/lobby/invitation";
afterEach(() => vi.unstubAllEnvs());
describe("canonical invitations", () => {
  it("uses a configured HTTPS origin in production and normalizes its slash", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PUBLIC_ORIGIN", "https://arena.example/");
    expect(invitationUrl(configuredOrigin()!, "ABCDEF")).toBe(
      "https://arena.example/join/ABCDEF",
    );
  });
  it("fails closed without a production origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PUBLIC_ORIGIN", "");
    expect(configuredOrigin).toThrow("APP_ORIGIN_REQUIRED");
  });
  it.each([
    "http://arena.example",
    "https://user:pass@arena.example",
    "https://arena.example/path",
    "https://arena.example?x=1",
    "https://arena.example/#frag",
    "https://localhost",
    "https://192.168.1.2",
    "javascript:alert(1)",
  ])("rejects unsafe production origin %s", (value) =>
    expect(() => validatePublicOrigin(value, true)).toThrow(),
  );
  it("supports development LAN links without a configured override", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_PUBLIC_ORIGIN", "");
    expect(configuredOrigin()).toBeNull();
    expect(invitationUrl("http://192.168.1.3:3000", "ABCDEF")).toBe(
      "http://192.168.1.3:3000/join/ABCDEF",
    );
  });
  it("uses the exact same URL for QR, copy fallback, and displayed link", () => {
    const url = invitationUrl("https://arena.example", "ABCDEF");
    const html = renderToStaticMarkup(
      createElement(Invitation, { code: "ABCDEF", url }),
    );
    expect(seen.qr).toBe(url);
    expect(seen.copy).toBe(url);
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain(`>${url}</a>`);
  });
  it("rejects malformed codes rather than constructing redirect paths", () =>
    expect(() => invitationUrl("https://arena.example", "../evil")).toThrow());
  it("rejects a forged Host and Origin even when they agree", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PUBLIC_ORIGIN", "https://arena.example");
    expect(() =>
      sameOrigin(
        new NextRequest("https://evil.example/api/rooms", {
          headers: { host: "evil.example", origin: "https://evil.example" },
        }),
      ),
    ).toThrow("BAD_ORIGIN");
  });
  it("accepts canonical same-origin production requests and rejects HTTP", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PUBLIC_ORIGIN", "https://arena.example");
    expect(() =>
      sameOrigin(
        new NextRequest("https://arena.example/api/rooms", {
          headers: { origin: "https://arena.example" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      sameOrigin(
        new NextRequest("http://arena.example/api/rooms", {
          headers: { origin: "http://arena.example" },
        }),
      ),
    ).toThrow("HTTPS_REQUIRED");
  });
});
