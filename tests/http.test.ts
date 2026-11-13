import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  createRoom: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("../src/lib/services/rooms", () => ({
  command: mocks.command,
  createRoom: mocks.createRoom,
}));
vi.mock("../src/lib/db/server", () => ({
  database: () => ({ rpc: mocks.rpc }),
}));
import { POST as create } from "../src/app/api/rooms/route";
import { POST as operate } from "../src/app/api/rooms/[code]/[action]/route";
const origin = "http://localhost:3000";
function request(
  path: string,
  data: object = {},
  cookie?: string,
  source: string | null = origin,
) {
  return new NextRequest(`${origin}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(source ? { origin: source } : {}),
      ...(cookie ? { cookie: `qa_session_ABCDEF=${cookie}` } : {}),
    },
    body: JSON.stringify(data),
  });
}
function context(action: string) {
  return { params: Promise.resolve({ code: "ABCDEF", action }) };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("APP_PUBLIC_ORIGIN", "https://quiz.example");
  vi.stubEnv("RATE_LIMIT_SALT", "test-salt-at-least-thirty-two-characters");
  vi.stubEnv(
    "SUPABASE_JWT_SECRET",
    "test-jwt-key-at-least-thirty-two-characters",
  );
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});
describe("HTTP security boundary", () => {
  it("accepts a LAN-origin join and issues a host-only development cookie", async () => {
    mocks.command.mockResolvedValue({});
    const req = new NextRequest(
      "http://192.168.1.50:3000/api/rooms/ABCDEF/join",
      {
        method: "POST",
        headers: {
          host: "192.168.1.50:3000",
          origin: "http://192.168.1.50:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Phone player" }),
      },
    );
    const result = await operate(req, context("join"));
    expect(result.status).toBe(201);
    const cookie = result.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).not.toContain("Secure");
    expect(cookie).not.toContain("Domain=");
  });
  it("rejects production LAN HTTP before creating an orphaned membership", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = await operate(
      request("/api/rooms/ABCDEF/join", { name: "Sam" }),
      context("join"),
    );
    expect(result.status).toBe(400);
    expect((await result.json()).code).toBe("HTTPS_REQUIRED");
    expect(mocks.command).not.toHaveBeenCalled();
  });
  it("retains Secure cookies on production HTTPS", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.command.mockResolvedValue({});
    const req = new NextRequest("https://quiz.example/api/rooms/ABCDEF/join", {
      method: "POST",
      headers: {
        origin: "https://quiz.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Sam" }),
    });
    const result = await operate(req, context("join"));
    expect(result.status).toBe(201);
    expect(result.headers.get("set-cookie")).toContain("Secure");
  });
  it("resumes an existing host session instead of replacing it with a player cookie", async () => {
    mocks.command.mockResolvedValue({ viewer: { role: "host" } });
    const result = await operate(
      request("/api/rooms/ABCDEF/join", { name: "Sam" }, "host-secret"),
      context("join"),
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("set-cookie")).toBeNull();
    expect(mocks.command).toHaveBeenCalledTimes(1);
    expect(mocks.command.mock.calls[0][0]).toBe("state");
  });
  it("preserves the real request host when Next.js normalizes loopback URLs", async () => {
    mocks.createRoom.mockResolvedValue("ABCDEF");
    const req = new NextRequest("http://localhost:3000/api/rooms", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Alex" }),
    });
    expect((await create(req)).status).toBe(201);
  });
  it("rejects cross-origin room creation before database access", async () => {
    const result = await create(
      request(
        "/api/rooms",
        { name: "Alex" },
        undefined,
        "https://evil.example",
      ),
    );
    expect(result.status).toBe(403);
    expect(mocks.createRoom).not.toHaveBeenCalled();
  });
  it("rejects requests without an origin", async () => {
    const result = await create(
      request("/api/rooms", { name: "Alex" }, undefined, null),
    );
    expect(result.status).toBe(403);
  });
  it("validates before invoking a room operation", async () => {
    const result = await create(
      request("/api/rooms", { name: "a", role: "host" }),
    );
    expect(result.status).toBe(400);
    expect(mocks.createRoom).not.toHaveBeenCalled();
  });
  it("returns a host cookie without exposing the credential in JSON", async () => {
    mocks.createRoom.mockResolvedValue("ABCDEF");
    const result = await create(request("/api/rooms", { name: "Alex" }));
    expect(result.status).toBe(201);
    expect(await result.json()).toEqual({ code: "ABCDEF" });
    expect(result.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(result.headers.get("set-cookie")).toMatch(/SameSite=lax/i);
    expect(mocks.createRoom.mock.calls[0][0]).toMatch(/^[a-f0-9]{64}$/);
  });
  it("requires a participant credential for private room state", async () => {
    const result = await operate(
      request("/api/rooms/ABCDEF/state"),
      context("state"),
    );
    expect(result.status).toBe(401);
    expect(mocks.command).not.toHaveBeenCalled();
  });
  it("maps unauthorized host actions to a forbidden response", async () => {
    mocks.command.mockRejectedValue(new Error("HOST_ONLY"));
    const result = await operate(
      request("/api/rooms/ABCDEF/start", {}, "player-token"),
      context("start"),
    );
    expect(result.status).toBe(403);
  });
  it("issues a separate HttpOnly player credential on joining", async () => {
    mocks.command.mockResolvedValue({});
    const result = await operate(
      request("/api/rooms/ABCDEF/join", { name: "Sam" }),
      context("join"),
    );
    expect(result.status).toBe(201);
    expect(result.headers.get("set-cookie")).toMatch(
      /qa_session_ABCDEF=.+;.*HttpOnly/i,
    );
    expect(mocks.command.mock.calls[0][0]).toBe("join");
  });
  it("rate-limits creation before creating a room", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const result = await create(request("/api/rooms", { name: "Alex" }));
    expect(result.status).toBe(429);
    expect(mocks.createRoom).not.toHaveBeenCalled();
  });
  it("issues a short-lived room-scoped token only after authorization", async () => {
    mocks.command.mockResolvedValue({
      id: "room-uuid",
      viewer: { id: "credential-uuid" },
    });
    const result = await operate(
      request("/api/rooms/ABCDEF/token", {}, "secret"),
      context("token"),
    );
    const { token } = await result.json();
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!),
    );
    expect(payload.role).toBe("authenticated");
    expect(payload.room_id).toBe("room-uuid");
    expect(payload.session_id).toBe("credential-uuid");
    expect(payload.exp! - payload.iat!).toBe(60);
    expect(result.headers.get("cache-control")).toBe("no-store");
  });
  it("clears the participant cookie when leaving", async () => {
    mocks.command.mockResolvedValue(null);
    const result = await operate(
      request("/api/rooms/ABCDEF/leave", {}, "secret"),
      context("leave"),
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("set-cookie")).toContain(
      "Expires=Thu, 01 Jan 1970",
    );
  });
});
