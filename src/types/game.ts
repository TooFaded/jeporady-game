export type RoomStatus = "lobby" | "in_progress" | "completed" | "cancelled";
export type Player = {
  id: string;
  nickname: string;
  score: number;
  is_connected: boolean;
  joined_at: string;
};
export type RoomState = {
  id: string;
  room_code: string;
  host_name: string;
  status: RoomStatus;
  settings: { max_players: number };
  expires_at: string;
  host_connected: boolean;
  players: Player[];
  viewer: { id: string; role: "host" | "player"; player_id: string | null };
};
