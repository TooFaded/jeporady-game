import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomSync } from "../src/features/lobby/room-sync";
import { ApiError, type api } from "../src/features/lobby/api";
import type {
  LiveStatus,
  RoomRealtime,
} from "../src/lib/supabase/room-realtime";
import type { RoomState } from "../src/types/game";
const initial: RoomState = {
  game: null,
  id: "room-id",
  room_code: "ABCDEF",
  host_name: "Alex",
  status: "lobby",
  settings: { max_players: 16 },
  expires_at: "2099-01-01",
  host_connected: true,
  players: [],
  viewer: { id: "host-session", role: "host", player_id: null },
};
const player = {
  id: "player-id",
  nickname: "Sam",
  score: 0,
  is_connected: true,
  joined_at: "2026-01-01",
};
async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
function fixture(request?: typeof api) {
  let changed = () => {};
  let status = (_value: LiveStatus) => {
    void _value;
  };
  let tokenProvider: () => Promise<string>;
  const transport: RoomRealtime = {
    authorize: vi.fn(async () => {
      await tokenProvider();
    }),
    open: vi.fn((_room, onChange, onStatus) => {
      changed = onChange;
      status = onStatus;
      status("SUBSCRIBED");
    }),
    close: vi.fn(async () => {}),
  };
  const make = vi.fn((provider: () => Promise<string>) => {
    tokenProvider = provider;
    return transport;
  });
  const fetcher =
    request ??
    (vi.fn(async (url: string) =>
      url.endsWith("/token") ? { token: "room-jwt" } : { room: initial },
    ) as typeof api);
  const sync = new RoomSync("ABCDEF", make, fetcher);
  return {
    sync,
    transport,
    make,
    fetcher,
    changed: () => changed(),
    status: (value: LiveStatus) => status(value),
    token: () => tokenProvider(),
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("room synchronization lifecycle", () => {
  it("updates host and second browser from the authoritative roster on a broadcast", async () => {
    let roster = initial;
    const request = vi.fn(async (url: string) =>
      url.endsWith("/token") ? { token: "jwt" } : { room: roster },
    ) as typeof api;
    const host = fixture(request),
      second = fixture(request);
    const a = host.sync.subscribe(() => {}),
      b = second.sync.subscribe(() => {});
    await flush();
    roster = { ...initial, players: [player] };
    host.changed();
    second.changed();
    await flush();
    expect(host.sync.getSnapshot().room?.players).toEqual([player]);
    expect(second.sync.getSnapshot().room?.players).toEqual([player]);
    roster = { ...initial, players: [] };
    host.changed();
    await flush();
    expect(host.sync.getSnapshot().room?.players).toEqual([]);
    a();
    b();
  });
  it("keeps fallback polling independent of a stalled token request", async () => {
    let roster = initial;
    const request = vi.fn((url: string) =>
      url.endsWith("/token")
        ? new Promise(() => {})
        : Promise.resolve({ room: roster }),
    ) as typeof api;
    const f = fixture(request);
    const stop = f.sync.subscribe(() => {});
    await flush();
    roster = { ...initial, players: [player] };
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.sync.getSnapshot().room?.players).toEqual([player]);
    expect(f.sync.getSnapshot().syncing).toBe(true);
    stop();
  });
  it("coalesces an event during an in-flight state fetch into a follow-up fetch", async () => {
    let release!: (value: unknown) => void;
    let count = 0;
    const request = vi.fn((url: string) => {
      if (url.endsWith("/token")) return Promise.resolve({ token: "jwt" });
      count++;
      return count === 2
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve({
            room: count > 2 ? { ...initial, players: [player] } : initial,
          });
    }) as typeof api;
    const f = fixture(request);
    const stop = f.sync.subscribe(() => {});
    await flush();
    f.changed();
    await flush();
    f.changed();
    release({ room: initial });
    await flush();
    expect(count).toBe(3);
    expect(f.sync.getSnapshot().room?.players).toEqual([player]);
    stop();
  });
  it("recreates failed channels and restores the latest roster", async () => {
    const f = fixture();
    const stop = f.sync.subscribe(() => {});
    await flush();
    f.status("CHANNEL_ERROR");
    await flush();
    expect(f.sync.getSnapshot().connected).toBe(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.transport.open).toHaveBeenCalledTimes(2);
    expect(f.make).toHaveBeenCalledTimes(1);
    expect(f.sync.getSnapshot().connected).toBe(true);
    stop();
  });
  it("does not create extra clients or channels for multiple subscribers", async () => {
    const f = fixture();
    const first = f.sync.subscribe(() => {}),
      second = f.sync.subscribe(() => {});
    await flush();
    expect(f.make).toHaveBeenCalledTimes(1);
    expect(f.transport.open).toHaveBeenCalledTimes(1);
    first();
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.sync.getSnapshot().syncing).toBe(true);
    second();
    await flush();
    expect(f.transport.close).toHaveBeenCalledTimes(1);
  });
  it("serializes channel cleanup on Strict Mode unsubscribe/resubscribe", async () => {
    const f = fixture();
    const first = f.sync.subscribe(() => {});
    await flush();
    first();
    const second = f.sync.subscribe(() => {});
    await flush();
    expect(f.make).toHaveBeenCalledTimes(1);
    expect(f.transport.open).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(f.transport.close).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(f.transport.open).mock.invocationCallOrder[1]);
    second();
  });
  it("stops heartbeats and token requests before leaving, and resumes if leave fails", async () => {
    const f = fixture();
    const stop = f.sync.subscribe(() => {});
    await flush();
    f.sync.pause();
    await flush();
    const calls = vi.mocked(f.fetcher).mock.calls.length;
    await vi.advanceTimersByTimeAsync(120000);
    expect(f.fetcher).toHaveBeenCalledTimes(calls);
    await expect(f.token()).rejects.toThrow("inactive");
    f.sync.resume();
    await flush();
    expect(vi.mocked(f.fetcher).mock.calls.length).toBeGreaterThan(calls);
    stop();
  });
  it("aborts pending requests and ignores stale completion after unmount", async () => {
    let release!: (value: unknown) => void;
    let signal: AbortSignal | undefined;
    const request = vi.fn((_url: string, _data: object, s?: AbortSignal) => {
      signal = s;
      return new Promise((resolve) => {
        release = resolve;
      });
    }) as typeof api;
    const f = fixture(request);
    const stop = f.sync.subscribe(() => {});
    await flush();
    stop();
    expect(signal?.aborted).toBe(true);
    release({ room: initial });
    await flush();
    expect(f.sync.getSnapshot().room).toBeNull();
    expect(f.make).not.toHaveBeenCalled();
  });
  it.each([401, 404])(
    "stops all synchronization after terminal authentication status %s",
    async (status) => {
      const request = vi.fn(async () => {
        throw new ApiError("Session expired", status);
      }) as typeof api;
      const f = fixture(request);
      const stop = f.sync.subscribe(() => {});
      await flush();
      expect(f.sync.getSnapshot().expired).toBe(true);
      await vi.advanceTimersByTimeAsync(120000);
      expect(request).toHaveBeenCalledTimes(1);
      stop();
    },
  );
  it("recovers after a transient network failure without making a new player", async () => {
    let online = false;
    const request = vi.fn(async (url: string) => {
      if (!online) throw new ApiError("Offline", 0);
      return url.endsWith("/token")
        ? { token: "jwt" }
        : { room: { ...initial, players: [player] } };
    }) as typeof api;
    const f = fixture(request);
    const stop = f.sync.subscribe(() => {});
    await flush();
    online = true;
    f.sync.refresh();
    await flush();
    expect(f.sync.getSnapshot().room?.players).toHaveLength(1);
    expect(
      vi.mocked(request).mock.calls.every(([url]) => !url.endsWith("/join")),
    ).toBe(true);
    stop();
  });
  it("refreshes the callback token as well as the channel token", async () => {
    let token = "first";
    const request = vi.fn(async (url: string) =>
      url.endsWith("/token") ? { token } : { room: initial },
    ) as typeof api;
    const f = fixture(request);
    const stop = f.sync.subscribe(() => {});
    await flush();
    expect(await f.token()).toBe("first");
    token = "second";
    await vi.advanceTimersByTimeAsync(30000);
    expect(await f.token()).toBe("second");
    expect(f.transport.authorize).toHaveBeenCalledTimes(2);
    stop();
  });
  it("does not overwrite a newer game mutation with an older heartbeat", async () => {
    const f = fixture();
    const stop = f.sync.subscribe(() => {});
    await flush();
    const game = {
      id: "board",
      version: 4,
      phase: "board" as const,
      categories: [],
      active_clue: null,
      completed_count: 1,
      ended_early: false,
      participants: [],
    };
    f.sync.acceptRoom({ ...initial, game });
    f.sync.acceptRoom({
      ...initial,
      game: { ...game, version: 3, completed_count: 0 },
    });
    expect(f.sync.getSnapshot().room?.game?.version).toBe(4);
    expect(f.sync.getSnapshot().room?.game?.completed_count).toBe(1);
    f.sync.refresh();
    await flush();
    expect(f.sync.getSnapshot().room?.game?.version).toBe(4);
    stop();
  });
  it("polls active competition every two seconds and stops on cleanup", async () => {
    const f = fixture();
    const stop = f.sync.subscribe(() => {});
    await flush();
    f.sync.acceptRoom({
      ...initial,
      game: {
        id: "board",
        version: 1,
        phase: "buzzers_open",
        categories: [],
        active_clue: null,
        completed_count: 0,
        ended_early: false,
        participants: [],
      },
    });
    const before = vi.mocked(f.fetcher).mock.calls.length;
    await vi.advanceTimersByTimeAsync(2100);
    expect(vi.mocked(f.fetcher).mock.calls.length).toBeGreaterThan(before);
    stop();
    const stopped = vi.mocked(f.fetcher).mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(f.fetcher).toHaveBeenCalledTimes(stopped);
  });
});
