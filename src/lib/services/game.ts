import "server-only";
import { database } from "@/lib/db/server";
import { RoomError } from "./rooms";
import type { GameRequest } from "@/lib/game-validation";
import type { RoomState } from "@/types/game";
import type { BoardEditorSnapshot } from "@/types/board";
export async function gameCommand(
  code: string,
  tokenHash: string,
  request: GameRequest,
): Promise<RoomState | BoardEditorSnapshot> {
  if (
    [
      "team_setup",
      "team_edit",
      "team_lock",
      "balance_teams",
      "choose_team",
      "assign_team",
    ].includes(request.action)
  ) {
    const { action, ...data } = request;
    const { data: room, error } = await database().rpc("team_command", {
      p_code: code,
      p_token_hash: tokenHash,
      p_action: action,
      p_expected_version:
        "expectedVersion" in request ? request.expectedVersion : null,
      p_data: data,
    });
    if (error)
      throw new RoomError(
        error.code === "PGRST202" ? "TEAM_NOT_CONFIGURED" : error.message,
      );
    return room as RoomState;
  }
  const competitive = [
    "buzz",
    "configure",
    "open",
    "close",
    "correct",
    "incorrect",
    "void",
  ].includes(request.action);
  const { data, error } = await database().rpc(
    competitive ? "competition_command" : "game_command",
    {
      p_code: code,
      p_token_hash: tokenHash,
      p_action: request.action,
      p_expected_version:
        "expectedVersion" in request ? request.expectedVersion : null,
      p_clue_id: "clueId" in request ? request.clueId : null,
      ...(competitive
        ? {
            p_round_id: "roundId" in request ? request.roundId : null,
            p_attempt_id: "attemptId" in request ? request.attemptId : null,
            p_mode: "mode" in request ? request.mode : null,
            p_seconds: "seconds" in request ? request.seconds : null,
          }
        : { p_board: request.action === "save" ? request.board : null }),
    },
  );
  if (error) {
    if (error.code === "PGRST202")
      throw new RoomError(
        competitive ? "COMPETITION_NOT_CONFIGURED" : "GAME_NOT_CONFIGURED",
      );
    throw new RoomError(error.message);
  }
  return data as RoomState | BoardEditorSnapshot;
}
