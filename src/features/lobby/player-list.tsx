import { Users } from "lucide-react";
import { Status } from "@/components/ui";
import type { Player } from "@/types/game";
export function PlayerList({
  players,
  self,
}: {
  players: Player[];
  self: string | null;
}) {
  if (!players.length)
    return (
      <div className="empty-players">
        <Users size={36} />
        <h3>The crew’s on their way.</h3>
        <p>Share your room code to get the night started.</p>
      </div>
    );
  return (
    <ul className="player-list">
      {players.map((player, index) => (
        <li key={player.id}>
          <span className={`avatar avatar-${index % 4}`}>
            {player.nickname.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <strong>
              {player.nickname}
              {player.id === self && <small> YOU</small>}
            </strong>
            <Status connected={player.is_connected}>
              {player.is_connected ? "Ready to play" : "Reconnecting…"}
            </Status>
          </div>
          <span className="player-score">
            {player.score}
            <small>PTS</small>
          </span>
        </li>
      ))}
    </ul>
  );
}
