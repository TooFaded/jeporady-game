import type { RoomState } from "@/types/game";
import { api, ApiError } from "./api";
import type { RoomRealtime } from "@/lib/supabase/room-realtime";
export type RoomSnapshot = {
  room: RoomState | null;
  error: string | null;
  connected: boolean;
  syncing: boolean;
  expired: boolean;
  realtimeError: string | null;
};
export const emptySnapshot: RoomSnapshot = {
  room: null,
  error: null,
  connected: false,
  syncing: false,
  expired: false,
  realtimeError: null,
};
type Request = typeof api;

/** One lifecycle per room, shared by subscribers. Transport failure never stops polling. */
export class RoomSync {
  private snapshot = emptySnapshot;
  private listeners = new Set<() => void>();
  private lifetime?: AbortController;
  private timer?: ReturnType<typeof setInterval>;
  private pollMs = 10000;
  private pending = false;
  private fetching = false;
  private connecting = false;
  private channel = false;
  private realtime?: RoomRealtime;
  private token: string | null = null;
  private tokenAt = 0;
  private shutdown: Promise<void> = Promise.resolve();
  private channelGeneration = 0;
  constructor(
    private code: string,
    private makeRealtime: (token: () => Promise<string>) => RoomRealtime,
    private request: Request = api,
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.resume();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.pause();
    };
  };
  private update(patch: Partial<RoomSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  acceptRoom = (room: RoomState) => {
    if (
      room.room_code !== this.code ||
      !this.lifetime ||
      this.lifetime.signal.aborted
    )
      return;
    const current = this.snapshot.room;
    if (
      current?.id === room.id &&
      (current.game?.version ?? -1) > (room.game?.version ?? -1)
    )
      return;
    const pollMs = [
      "buzzers_open",
      "rebound_open",
      "player_answering",
      "answer_judging",
    ].includes(room.game?.phase ?? "")
      ? 2000
      : 10000;
    if (pollMs !== this.pollMs) {
      this.pollMs = pollMs;
      clearInterval(this.timer);
      this.timer = setInterval(this.refresh, pollMs);
    }
    this.update({ room, error: null, syncing: true });
  };
  private alive(lifetime: AbortController) {
    return this.lifetime === lifetime && !lifetime.signal.aborted;
  }
  pause = () => {
    this.lifetime?.abort();
    this.lifetime = undefined;
    clearInterval(this.timer);
    this.timer = undefined;
    this.pollMs = 10000;
    this.pending = false;
    this.fetching = false;
    this.connecting = false;
    this.token = null;
    this.tokenAt = 0;
    this.closeChannel();
    this.update({
      room: null,
      error: null,
      connected: false,
      syncing: false,
      realtimeError: null,
    });
  };
  private closeChannel() {
    this.channelGeneration++;
    this.channel = false;
    // Serialize old-channel removal before a Strict Mode remount or reconnect.
    this.shutdown = this.shutdown
      .then(() => this.realtime?.close())
      .catch(() => {});
  }
  resume = () => {
    if (this.lifetime || this.snapshot.expired) return;
    this.lifetime = new AbortController();
    this.timer = setInterval(this.refresh, 10000);
    this.refresh();
  };
  private fail(error: unknown, lifetime: AbortController) {
    if (!this.alive(lifetime)) return;
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 404)
    ) {
      this.pause();
      this.update({ room: null, error: error.message, expired: true });
    } else {
      this.update({
        error:
          error instanceof Error ? error.message : "Connection lost. Retrying…",
        syncing: false,
      });
    }
  }
  refresh = () => {
    const lifetime = this.lifetime;
    if (!lifetime || lifetime.signal.aborted) return;
    this.pending = true;
    if (!this.fetching) void this.drain(lifetime);
  };
  private async drain(lifetime: AbortController) {
    this.fetching = true;
    try {
      while (this.pending && this.alive(lifetime)) {
        this.pending = false;
        try {
          const { room } = await this.request<{ room: RoomState }>(
            `/api/rooms/${this.code}/heartbeat`,
            {},
            lifetime.signal,
          );
          if (!this.alive(lifetime)) return;
          this.acceptRoom(room);
          void this.ensureRealtime(room, lifetime);
        } catch (error) {
          this.fail(error, lifetime);
        }
      }
    } finally {
      if (this.alive(lifetime)) this.fetching = false;
    }
  }
  private async ensureRealtime(room: RoomState, lifetime: AbortController) {
    if (this.connecting || !this.alive(lifetime)) return;
    if (this.channel && Date.now() - this.tokenAt < 30000) return;
    this.connecting = true;
    try {
      const { token } = await this.request<{ token: string }>(
        `/api/rooms/${this.code}/token`,
        {},
        lifetime.signal,
      );
      if (!this.alive(lifetime)) return;
      this.token = token;
      this.tokenAt = Date.now();
      if (!this.realtime)
        this.realtime = this.makeRealtime(async () => {
          if (!this.token || !this.lifetime || this.lifetime.signal.aborted)
            throw new Error("Room session is inactive");
          return this.token;
        });
      await this.shutdown;
      if (!this.alive(lifetime)) return;
      await this.realtime.authorize();
      if (!this.alive(lifetime)) return;
      if (!this.channel) {
        this.channel = true;
        const generation = ++this.channelGeneration;
        this.realtime.open(
          room,
          () => {
            if (this.alive(lifetime) && generation === this.channelGeneration)
              this.refresh();
          },
          (status) => {
            if (!this.alive(lifetime) || generation !== this.channelGeneration)
              return;
            if (status === "SUBSCRIBED")
              this.update({ connected: true, realtimeError: null });
            else {
              this.update({
                connected: false,
                realtimeError:
                  "Live connection interrupted. Retrying; backup synchronization remains active.",
              });
              this.closeChannel();
            }
          },
        );
      }
    } catch (error) {
      if (!this.alive(lifetime)) return;
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 404)
      )
        this.fail(error, lifetime);
      else {
        this.update({
          connected: false,
          realtimeError:
            "Live connection unavailable. Retrying; backup synchronization remains active.",
        });
        this.closeChannel();
      }
    } finally {
      if (this.alive(lifetime)) this.connecting = false;
    }
  }
}
