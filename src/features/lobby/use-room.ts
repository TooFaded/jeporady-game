"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createRoomRealtime } from "@/lib/supabase/room-realtime";
import { emptySnapshot, RoomSync } from "./room-sync";
// Per-room isolation matters: a token for one room must never replace another's.
const rooms = new Map<string, RoomSync>();
function getRoom(code: string) {
  if (typeof window === "undefined")
    return new RoomSync(code, createRoomRealtime);
  let room = rooms.get(code);
  if (!room || room.getSnapshot().expired) {
    room = new RoomSync(code, createRoomRealtime);
    rooms.set(code, room);
  }
  return room;
}
const getServerSnapshot = () => emptySnapshot;
export function useRoom(code: string) {
  const sync = useMemo(() => getRoom(code), [code]);
  const snapshot = useSyncExternalStore(
    sync.subscribe,
    sync.getSnapshot,
    getServerSnapshot,
  );
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === "visible") sync.refresh();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [sync]);
  return {
    ...snapshot,
    pause: sync.pause,
    resume: sync.resume,
    refresh: sync.refresh,
    acceptRoom: sync.acceptRoom,
  };
}
