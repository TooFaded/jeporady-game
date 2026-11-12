"use client";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import type { RoomState } from "@/types/game";
import { api } from "./api";
export function useRoom(code: string) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let stopped = false;
    let fetching = false;
    let connecting = false;
    let hasChannel = false;
    const client =
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        ? createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            { auth: { persistSession: false, autoRefreshToken: false } },
          )
        : null;
    async function refresh() {
      if (fetching || stopped) return;
      fetching = true;
      try {
        const result = await api<{ room: RoomState }>(
          `/api/rooms/${code}/heartbeat`,
        );
        if (!stopped) {
          setRoom(result.room);
          setError(null);
        }
        return result.room;
      } catch (error) {
        if (!stopped) {
          setError(
            error instanceof Error
              ? error.message
              : "Connection lost. Reconnecting…",
          );
          setConnected(false);
        }
      } finally {
        fetching = false;
      }
    }
    async function authenticate() {
      const { token } = await api<{ token: string }>(
        `/api/rooms/${code}/token`,
      );
      if (!stopped && client) await client.realtime.setAuth(token);
    }
    async function connect() {
      if (connecting || hasChannel || stopped) return;
      connecting = true;
      const initial = await refresh();
      if (!initial || !client || stopped) {
        connecting = false;
        return;
      }
      try {
        await authenticate();
        if (stopped) return;
        hasChannel = true;
        const channel = client.channel(`room:${initial.id}`, {
          config: { private: true, presence: { key: initial.viewer.id } },
        });
        // Presence is a refresh signal only: client-supplied identity is never authoritative.
        channel
          .on("broadcast", { event: "room_changed" }, () => {
            void refresh();
          })
          .on("presence", { event: "sync" }, () => {
            void refresh();
          })
          .subscribe(async (status) => {
            if (stopped) return;
            setConnected(status === "SUBSCRIBED");
            if (status === "SUBSCRIBED") {
              await channel.track({ online: true });
              void refresh();
            }
          });
      } catch {
        if (!stopped) setConnected(false);
      } finally {
        connecting = false;
      }
    }
    void connect();
    const heartbeat = setInterval(() => {
      if (hasChannel) void refresh();
      else void connect();
    }, 10000);
    const renewal = setInterval(() => {
      void authenticate().catch(() => {
        if (!stopped) setConnected(false);
      });
    }, 40000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        void authenticate().catch(() => setConnected(false));
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      stopped = true;
      clearInterval(heartbeat);
      clearInterval(renewal);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      if (client) void client.removeAllChannels();
    };
  }, [code]);
  return { room, error, connected, setRoom };
}
