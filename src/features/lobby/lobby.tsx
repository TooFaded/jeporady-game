"use client";
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowRight,
  Crown,
  LogOut,
  Radio,
  Sparkles,
  Users,
} from "lucide-react";
import { Button, Card, ErrorMessage, Loading, Status } from "@/components/ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useRoom } from "./use-room";
import { api } from "./api";
import { PlayerList } from "./player-list";
import { RoomCode } from "./room-code";
import type { RoomState } from "@/types/game";
const subscribeToOrigin = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";
export function Lobby({ code }: { code: string }) {
  const { room, error, connected, setRoom } = useRoom(code);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const router = useRouter();
  const origin = useSyncExternalStore(
    subscribeToOrigin,
    getOrigin,
    getServerOrigin,
  );
  const invite = origin ? `${origin}/join/${code}` : "";
  async function action(type: "start" | "leave") {
    setBusy(true);
    setActionError(null);
    try {
      const result = await api<{ room: RoomState }>(
        `/api/rooms/${code}/${type}`,
      );
      if (type === "leave") router.push("/");
      else setRoom(result.room);
    } catch (error) {
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
  const ready = room.players.filter((p) => p.is_connected).length;
  return (
    <main id="main" className="lobby-page">
      <div className="lobby-heading">
        <div>
          <span className="eyebrow">
            <Radio size={14} /> THE GATHERING PLACE
          </span>
          <h1>
            {room.status === "in_progress"
              ? "The stage is set."
              : "Welcome to the lobby."}
          </h1>
          <p>
            {host
              ? "You’re the host. Gather your crew and get ready for a great night."
              : `${room.host_name} is your host. Settle in. The fun is just getting started.`}
          </p>
        </div>
        <Status connected={connected}>
          {connected ? "Live connection" : "Reconnecting · backup sync active"}
        </Status>
      </div>
      <ErrorMessage message={error || actionError} />
      {room.status === "in_progress" ? (
        <Card className="phase-card">
          <span className="large-icon">
            <Sparkles />
          </span>
          <span className="eyebrow">LOBBY COMPLETE · UP NEXT</span>
          <h2>Game night is officially on.</h2>
          <p>The game board will be implemented in Phase 2.</p>
          <p className="muted">
            Your room has started successfully. Categories, clues, and answers
            are next.
          </p>
          <div className="phase-grid" aria-hidden="true">
            {Array.from({ length: 15 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
          <span className="phase-badge">PHASE 2 · COMING NEXT</span>
        </Card>
      ) : room.status !== "lobby" ? (
        <Card>
          <h2>This game has ended.</h2>
          <Link href="/">Back to home</Link>
        </Card>
      ) : null}
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
          <PlayerList players={room.players} self={room.viewer.player_id} />
          <div className="roster-bottom">
            <span className="live-dot" /> Players appear automatically as they
            join.
          </div>
        </Card>
        <aside>
          <Card className="invite-card">
            <span className="eyebrow">GOOD COMPANY STARTS WITH AN INVITE</span>
            <h2>Bring your people.</h2>
            <p>Share the code. Or scan, join, and settle in.</p>
            <RoomCode code={code} invite={invite} />
            {invite && (
              <>
                <div className="qr-wrap">
                  <QRCodeSVG
                    value={invite}
                    size={132}
                    marginSize={2}
                    title="Scan to join this QuizArena room"
                  />
                </div>
                <a className="invite-url" href={invite}>
                  {invite}
                </a>
              </>
            )}
            <div className="invite-caption">
              Any phone. Any browser. Everyone’s welcome.
            </div>
          </Card>
        </aside>
      </div>
      <div className="lobby-controls">
        <Button variant="ghost" onClick={() => setLeaving(true)}>
          <LogOut size={17} />
          {host ? "Close room" : "Leave room"}
        </Button>
        {room.status === "lobby" && (
          <div className="start-controls">
            <span>
              {host
                ? ready
                  ? `${ready} player${ready === 1 ? "" : "s"} ready. Let’s do this.`
                  : "Waiting for your first player…"
                : "Waiting for the host to start…"}
            </span>
            {host && (
              <Button
                busy={busy}
                disabled={ready === 0}
                onClick={() => void action("start")}
              >
                Start Game <ArrowRight size={18} />
              </Button>
            )}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={leaving}
        title={host ? "Close the arena?" : "Heading out?"}
        description={
          host
            ? "Leaving as the host closes this room for everyone. You can create a new room anytime."
            : "You’ll leave the player list. You can rejoin while the lobby is still open."
        }
        busy={busy}
        onCancel={() => setLeaving(false)}
        onConfirm={() => void action("leave")}
      />
    </main>
  );
}
