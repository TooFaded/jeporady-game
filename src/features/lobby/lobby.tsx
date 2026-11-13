"use client";
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Crown, LogOut, Radio, Users } from "lucide-react";
import { Button, Card, ErrorMessage, Loading, Status } from "@/components/ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useRoom } from "./use-room";
import { BoardEditor } from "@/features/game/board-editor";
import { TeamLobby } from "@/features/game/team-lobby";
import { invitationUrl } from "@/lib/invitations";
import { GameView } from "@/features/game/game-view";
import { api } from "./api";
import { PlayerList } from "./player-list";
import { Invitation } from "./invitation";
import type { RoomState } from "@/types/game";
const subscribeToOrigin = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";
export function Lobby({
  code,
  publicOrigin = null,
}: {
  code: string;
  publicOrigin?: string | null;
}) {
  const {
    room,
    error,
    connected,
    syncing,
    realtimeError,
    pause,
    resume,
    refresh,
    acceptRoom,
  } = useRoom(code);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const router = useRouter();
  const origin = useSyncExternalStore(
    subscribeToOrigin,
    getOrigin,
    getServerOrigin,
  );
  const inviteOrigin = publicOrigin ?? origin;
  const invite = inviteOrigin ? invitationUrl(inviteOrigin, code) : "";
  async function leave() {
    setBusy(true);
    setActionError(null);
    pause();
    try {
      await api<{ room: RoomState }>(`/api/rooms/${code}/leave`);
      router.push("/");
    } catch (error) {
      resume();
      setActionError(
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setBusy(false);
      setLeaving(false);
    }
  }
  if (!room)
    return (
      <main id="main" className="entry-page">
        {error ? (
          <Card className="entry-card">
            <h1>Let’s get you connected.</h1>
            <ErrorMessage message={error} />
            <Link href={`/join/${code}`} className="button button-primary">
              Join this room <ArrowRight size={16} />
            </Link>
            <Link href="/" className="back-link">
              Back home
            </Link>
          </Card>
        ) : (
          <Loading />
        )}
      </main>
    );
  const host = room.viewer.role === "host";
  const onRoom = (updated: RoomState) => {
    acceptRoom(updated);
    refresh();
  };
  return (
    <main id="main" className="lobby-page">
      <div className="lobby-heading">
        <div>
          <span className="eyebrow">
            <Radio size={14} /> THE GATHERING PLACE
          </span>
          <h1>
            {room.status !== "lobby"
              ? "Welcome to the arena."
              : "Welcome to the lobby."}
          </h1>
          <p>
            {host
              ? "You’re the host. Gather your crew and get ready for a great night."
              : `${room.host_name} is your host. Settle in. The fun is just getting started.`}
          </p>
        </div>
        <Status connected={connected}>
          {connected
            ? "Live connection"
            : syncing
              ? "Backup sync active · reconnecting live"
              : "Connection interrupted · retrying"}
        </Status>
      </div>
      <ErrorMessage message={error || actionError} />
      {realtimeError && !error && (
        <p role="status" className="input-hint">
          {realtimeError}
        </p>
      )}
      {room.status !== "lobby" && (
        <GameView room={room} onRoom={onRoom} onRefresh={refresh} />
      )}
      {room.status === "lobby" && (
        <TeamLobby room={room} onRoom={onRoom} onRefresh={refresh} />
      )}
      {room.status === "lobby" && host && (
        <BoardEditor room={room} onRoom={onRoom} />
      )}
      {room.status === "lobby" && (
        <>
          <div className="lobby-grid">
            <Card className="roster-card">
              <div className="card-heading">
                <h2>
                  <Users size={20} /> The lineup
                </h2>
                <span>
                  {room.players.length} / {room.settings.max_players} players
                </span>
              </div>
              <div className="host-row">
                <span className="avatar host-avatar">
                  <Crown size={23} />
                </span>
                <div>
                  <strong>
                    {room.host_name} {host && <small>YOU</small>}
                  </strong>
                  <Status connected={room.host_connected}>
                    {room.host_connected
                      ? "Your game-night host"
                      : "Host reconnecting…"}
                  </Status>
                </div>
                <span className="host-label">HOST</span>
              </div>
              <PlayerList
                players={room.players}
                self={room.viewer.player_id}
                hideScores={room.game?.competition?.play_mode === "team"}
              />
              <div className="roster-bottom">
                <span className="live-dot" /> Players appear automatically as
                they join.
              </div>
            </Card>
            <aside>
              <Card className="invite-card">
                <span className="eyebrow">
                  GOOD COMPANY STARTS WITH AN INVITE
                </span>
                <h2>Bring your people.</h2>
                <p>Share the code. Or scan, join, and settle in.</p>
                <Invitation key={invite} code={code} url={invite} />
                <div className="invite-caption">
                  Any phone. Any browser. Everyone’s welcome.
                </div>
              </Card>
            </aside>
          </div>
        </>
      )}
      <div className="lobby-controls">
        <Button variant="ghost" onClick={() => setLeaving(true)}>
          <LogOut size={17} />
          {host && room.status !== "completed" ? "Close room" : "Leave room"}
        </Button>
        {room.status === "lobby" && !host && (
          <p className="player-waiting">
            Waiting for the host to prepare the board and start…
          </p>
        )}
      </div>
      <ConfirmDialog
        open={leaving}
        title={
          host && room.status !== "completed"
            ? "Close the arena?"
            : "Heading out?"
        }
        description={
          room.status === "completed"
            ? "You’ll leave this room. Other participants can still view the completed game."
            : host
              ? "Leaving as the host closes this room for everyone. You can create a new room anytime."
              : "You’ll leave the player list. You can rejoin while the lobby is still open."
        }
        busy={busy}
        onCancel={() => setLeaving(false)}
        onConfirm={() => void leave()}
      />
    </main>
  );
}
