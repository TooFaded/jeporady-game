import { api, ApiError } from "./api";
import type { RoomState } from "@/types/game";
export async function verifyRoomSession(
  code: string,
  request: typeof api = api,
) {
  try {
    return await request<{ room: RoomState }>(`/api/rooms/${code}/state`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw new Error(
        "Your browser did not retain the room session. Keep this same address open and allow site cookies. For LAN testing, run npm run dev:lan; production requires HTTPS.",
      );
    }
    throw error;
  }
}
