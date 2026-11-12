import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoomRealtime } from "../src/lib/supabase/room-realtime";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("actual Supabase SDK custom-auth lifecycle", () => {
  it("uses room token callbacks without constructing conflicting GoTrue clients", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_test");
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    let token = "first-room-token";
    const firstProvider = vi.fn(async () => token);
    const secondProvider = vi.fn(async () => "second-room-token");
    const first = createRoomRealtime(firstProvider),
      second = createRoomRealtime(secondProvider);
    await first.authorize();
    await second.authorize();
    token = "renewed-first-room-token";
    await first.authorize();
    expect(firstProvider).toHaveBeenCalled();
    expect(secondProvider).toHaveBeenCalled();
    expect(warnings.mock.calls.flat().join(" ")).not.toContain(
      "Multiple GoTrueClient",
    );
    expect(await firstProvider()).toBe("renewed-first-room-token");
    expect(await secondProvider()).toBe("second-room-token");
    await first.close();
    await second.close();
  });
});
