"use client";
import { createClient } from "@supabase/supabase-js";
import type { RoomState } from "@/types/game";
export type LiveStatus =
  "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR";
export interface RoomRealtime {
  authorize(): Promise<void>;
  open(
    room: RoomState,
    changed: () => void,
    status: (value: LiveStatus) => void,
  ): void;
  close(): Promise<void>;
}
export function createRoomRealtime(
  accessToken: () => Promise<string>,
): RoomRealtime {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Realtime configuration is missing.");
  // Custom auth is intentional: no GoTrueClient is instantiated. Reconnect and
  // SDK heartbeat auth use this same room-scoped callback, never anonymous Auth.
  const client = createClient(url, key, { accessToken });
  let channel: ReturnType<typeof client.channel> | undefined;
  return {
    authorize: () => client.realtime.setAuth(),
    open(room, changed, status) {
      const current = client.channel(`room:${room.id}`, {
        config: { private: true, presence: { key: room.viewer.id } },
      });
      channel = current;
      current
        .on("broadcast", { event: "room_changed" }, changed)
        .on("presence", { event: "sync" }, changed)
        .subscribe((value) => {
          status(value);
          if (value === "SUBSCRIBED" && channel === current) {
            void current.track({ online: true }).catch(() => {});
            changed();
          }
        });
    },
    async close() {
      const current = channel;
      channel = undefined;
      if (current) await client.removeChannel(current);
      client.realtime.disconnect();
    },
  };
}
