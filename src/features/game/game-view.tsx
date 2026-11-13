"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Crown,
  Eye,
  Flag,
  Grid2X2,
  Users,
} from "lucide-react";
import { Button, Card, ErrorMessage } from "@/components/ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CompetitionControls, Leaderboard } from "./competition";
import { PlayerList } from "@/features/lobby/player-list";
import { api } from "@/features/lobby/api";
import type { RoomState } from "@/types/game";
import type { GameRequest } from "@/lib/game-validation";
export function GameView({
  room,
  onRoom,
  onRefresh,
}: {
  room: RoomState;
  onRoom: (room: RoomState) => void;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const game = room.game;
  const host = room.viewer.role === "host";
  const phase = game?.phase;
  const active = game?.active_clue;
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [phase, active?.id]);
  async function mutate(
    action: "select" | "reveal" | "complete" | "return" | "end",
    clueId?: string,
  ) {
    if (!game || !host || busy) return;
    setBusy(true);
    setError(null);
    const input = {
      action,
      expectedVersion: game.version,
      ...(clueId ? { clueId } : {}),
    } as GameRequest;
    try {
      const { room: updated } = await api<{ room: RoomState }>(
        `/api/rooms/${room.room_code}/game`,
        input,
      );
      onRoom(updated);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not update the game.",
      );
      onRefresh();
    } finally {
      setBusy(false);
      setEnding(false);
    }
  }
  if (!game)
    return (
      <Card>
        <h2>Preparing the arena</h2>
        <p>
          This room needs the Phase 2 database migration. Apply it and refresh
          to load the board.
        </p>
        <Button variant="secondary" onClick={onRefresh}>
          Refresh board
        </Button>
      </Card>
    );
  return (
    <section className="game-stage" aria-label="Shared game board">
      <ErrorMessage message={error} />
      <div className="game-toolbar">
        <div className="game-phase-label">
          <span className="live-dot" />
          <span>
            {phase === "completed"
              ? "GAME COMPLETE"
              : phase === "board"
                ? "THE BOARD IS YOURS"
                : phase === "answer_revealed"
                  ? "THE ANSWER IS IN"
                  : "CLUE IN PLAY"}
          </span>
        </div>
        <div className="game-meta">
          <span>
            <Users size={15} />
            {room.players.filter((p) => p.is_connected).length} online
          </span>
          <span>{game.completed_count} / 25 played</span>
        </div>
      </div>
      {phase === "completed" ? (
        <Card className="game-finished">
          <span className="large-icon">
            <Crown size={29} />
          </span>
          <span className="eyebrow">THAT’S A WRAP</span>
          <h2 ref={heading} tabIndex={-1}>
            Good questions. Great company.
          </h2>
          <p>
            {game.ended_early
              ? "Your host has ended the game."
              : "All 25 clues complete. You’ve cleared the arena!"}
          </p>
          <div className="finished-count">
            <CheckCircle2 size={20} />
            {game.completed_count} of 25 clues explored
          </div>
          <h3>The game-night crew</h3>
          <ul className="finished-players">
            {game.participants.map((player) => (
              <li key={player.id}>{player.nickname}</li>
            ))}
          </ul>
          <p className="input-hint">
            Hosted by {room.host_name}. Thanks for playing together.
          </p>
        </Card>
      ) : active ? (
        <Card className="game-clue-card">
          <div className="clue-topline">
            <span>{active.category_name}</span>
            <span>{active.value.toLocaleString("en-US")} POINTS</span>
          </div>
          <h2 ref={heading} tabIndex={-1} className="game-clue-question">
            {active.question}
          </h2>
          {phase === "answer_revealed" ? (
            <div className="revealed-answer" aria-live="polite">
              <span className="eyebrow">
                <CheckCircle2 size={16} /> THE CORRECT ANSWER
              </span>
              <p>{active.answer}</p>
            </div>
          ) : (
            <div className="answer-hidden">
              <Eye size={17} />
              Take a moment. The host will reveal the answer.
            </div>
          )}
          {host && game.host_answer && phase !== "answer_revealed" && (
            <details className="host-answer-reference">
              <summary>Host-only answer reference</summary>
              <p>{game.host_answer}</p>
            </details>
          )}
          {game.competition && (
            <CompetitionControls
              room={room}
              onRoom={onRoom}
              onRefresh={onRefresh}
            />
          )}
          {host ? (
            <div className="clue-actions">
              {phase === "clue_active" ? (
                <>
                  <Button
                    variant="ghost"
                    busy={busy}
                    disabled={!!game.competition?.attempted_player_ids.length}
                    onClick={() => void mutate("return", active.id)}
                  >
                    <ArrowLeft size={17} />
                    Return to board
                  </Button>
                  <Button
                    busy={busy}
                    onClick={() => void mutate("reveal", active.id)}
                  >
                    <Eye size={18} />
                    Reveal Answer
                  </Button>
                </>
              ) : phase === "answer_revealed" ? (
                <Button
                  busy={busy}
                  onClick={() => void mutate("complete", active.id)}
                >
                  <Check size={18} />
                  Complete clue & return
                  <ArrowRight size={17} />
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="player-waiting" role="status">
              {phase === "answer_revealed"
                ? "Waiting for the host to return everyone to the board."
                : "Your host controls the reveal. Think it over together."}
            </p>
          )}
        </Card>
      ) : (
        <>
          <div className="board-intro">
            <h2 ref={heading} tabIndex={-1}>
              {host
                ? "Pick your next challenge."
                : "What’s your winning category?"}
            </h2>
            <p>
              {host
                ? "Choose any available tile to bring it up for everyone."
                : "Follow along. Only the host can select clues and reveal answers."}
            </p>
          </div>
          <div
            className="playable-board"
            aria-label="Five categories with five clues each"
          >
            {game.categories.map((category) => (
              <section
                className="board-column"
                key={category.id}
                aria-labelledby={`board-category-${category.id}`}
              >
                <h3 id={`board-category-${category.id}`}>{category.name}</h3>
                {category.clues.map((clue) => (
                  <button
                    type="button"
                    key={clue.id}
                    className={`clue-tile ${clue.completed ? "clue-completed" : ""}`}
                    disabled={!host || busy || clue.completed}
                    aria-label={`${category.name}, ${clue.value} points${clue.completed ? ", completed" : host ? "" : ", host selection only"}`}
                    onClick={() => void mutate("select", clue.id)}
                  >
                    {clue.completed ? (
                      <>
                        <Check size={25} />
                        <span className="tile-completed-label">PLAYED</span>
                      </>
                    ) : (
                      clue.value.toLocaleString("en-US")
                    )}
                  </button>
                ))}
              </section>
            ))}
          </div>
          <p className="board-footnote">
            <Grid2X2 size={15} />
            {25 - game.completed_count} clues left to explore
            <span>Every device. The same arena.</span>
          </p>
        </>
      )}
      {game.competition && (
        <Leaderboard
          competition={game.competition}
          final={phase === "completed"}
        />
      )}
      <details className="game-roster">
        <summary>
          <Users size={18} /> The crew{" "}
          <span>{room.players.length} players</span>
        </summary>
        <PlayerList
          players={room.players}
          self={room.viewer.player_id}
          hideScores={room.game?.competition?.play_mode === "team"}
        />
      </details>
      {host && phase !== "completed" && (
        <div className="end-game-row">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setEnding(true)}
          >
            <Flag size={16} />
            End game early
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={ending}
        title="End this game?"
        description="Everyone will see the game-complete screen. Unplayed clues will stay unplayed, and this game cannot be restarted."
        busy={busy}
        confirmLabel="End game"
        cancelLabel="Keep playing"
        onCancel={() => setEnding(false)}
        onConfirm={() => void mutate("end")}
      />
    </section>
  );
}
