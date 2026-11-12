import "server-only";
import { database } from "@/lib/db/server";
import { generateCode } from "@/lib/utils/security";
import type { RoomState } from "@/types/game";
export class RoomError extends Error {}
export async function command(
  action: string,
  code: string,
  tokenHash: string,
  name?: string,
): Promise<RoomState | null> {
  const { data, error } = await database().rpc("room_command", {
    p_action: action,
    p_code: code,
    p_token_hash: tokenHash,
    p_name: name ?? null,
  });
  if (error) throw new RoomError(error.message);
  return data as RoomState | null;
}
export async function createRoom(
  tokenHash: string,
  name: string,
  generator = generateCode,
) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generator();
    try {
      await command("create", code, tokenHash, name);
      return code;
    } catch (error) {
      if (
        !(error instanceof RoomError) ||
        !error.message.includes("CODE_TAKEN")
      )
        throw error;
    }
  }
  throw new RoomError("BUSY");
}
