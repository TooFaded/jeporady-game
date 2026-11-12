import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/features/lobby/api";
import { verifyRoomSession } from "../src/features/lobby/enter-room";
afterEach(() => vi.unstubAllGlobals());
describe("browser session persistence", () => {
  it("confirms a fresh cookie-authenticated request before navigation", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ room: { viewer: { role: "player" } } });
    await verifyRoomSession("ABCDEF", request);
    expect(request).toHaveBeenCalledWith("/api/rooms/ABCDEF/state");
  });
  it("reports a rejected session instead of silently returning to the join form", async () => {
    const request = vi
      .fn()
      .mockRejectedValue(new ApiError("Unauthorized", 401));
    await expect(verifyRoomSession("ABCDEF", request)).rejects.toThrow(
      "did not retain",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("sends same-origin cookies and works without AbortSignal.timeout", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetcher);
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      throw new Error("unsupported");
    });
    expect(await api("/api/test")).toEqual({ ok: true });
    expect(fetcher.mock.calls[0][1].credentials).toBe("same-origin");
    timeout.mockRestore();
  });
  it("preserves HTTP status for terminal authentication handling", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: "Expired", code: "UNAUTHORIZED" }),
            { status: 401 },
          ),
        ),
    );
    await expect(api("/api/test")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
  });
  it("propagates lifecycle cancellation to fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, options) =>
          new Promise((_resolve, reject) =>
            options.signal.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            ),
          ),
      ),
    );
    const controller = new AbortController();
    const request = api("/api/test", {}, controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});
