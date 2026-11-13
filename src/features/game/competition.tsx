"use client";
import { useEffect, useState } from "react";
import { Button, Card, ErrorMessage } from "@/components/ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api } from "@/features/lobby/api";
import type { RoomState } from "@/types/game";
import type { GameRequest } from "@/lib/game-validation";
import type { CompetitionSnapshot } from "@/types/board";

export function Leaderboard({
  competition,
  final = false,
}: {
  competition: CompetitionSnapshot;
  final?: boolean;
}) {
  if (competition.play_mode === "team")
    return <TeamLeaderboard competition={competition} final={final} />;
  const leaders = competition.leaderboard.filter((p) => p.rank === 1);
  return (
    <Card className="leaderboard">
      <h2>{final ? "Final rankings" : "Live leaderboard"}</h2>
      {final && leaders.length > 0 && (
        <p className="winner-message">
          {leaders.length > 1 ? "Shared victory: " : "Arena champion: "}
          {leaders.map((p) => p.nickname).join(" & ")}!
        </p>
      )}
      <div className="leaderboard-table">
        <table>
          <caption className="sr-only">
            Rank, score and answer counts. Equal scores share a rank.
          </caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Player</th>
              <th scope="col">Score</th>
              <th scope="col">Right</th>
              <th scope="col">Wrong</th>
            </tr>
          </thead>
          <tbody>
            {competition.leaderboard.map((p) => (
              <tr key={p.id} className={p.rank === 1 ? "leader-row" : ""}>
                <td>{p.rank}</td>
                <th scope="row">{p.nickname}</th>
                <td>{p.score.toLocaleString("en-US")}</td>
                <td>{p.correct}</td>
                <td>{p.incorrect}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="input-hint">
        {competition.scoring_mode === "classic"
          ? "Classic · correct +points, incorrect −points"
          : "Casual · correct +points, no penalty"}{" "}
        · Equal scores share a rank.
      </p>
    </Card>
  );
}

export function CompetitionSettings({
  room,
  onRoom,
}: {
  room: RoomState;
  onRoom: (room: RoomState) => void;
}) {
  const c = room.game?.competition;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(mode: string, seconds: number) {
    if (!room.game) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ room: RoomState }>(
        `/api/rooms/${room.room_code}/game`,
        {
          action: "configure",
          expectedVersion: room.game.version,
          mode,
          seconds,
        },
      );
      onRoom(result.room);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }
  if (!c)
    return (
      <p className="input-hint">
        Apply the Phase 3 migration to enable buzzers and scoring.
      </p>
    );
  return (
    <fieldset className="competition-settings" disabled={busy}>
      <legend>Competitive rules · saved automatically</legend>
      <label>
        Scoring mode
        <select
          value={c.scoring_mode}
          onChange={(e) => void save(e.target.value, c.answer_seconds)}
        >
          <option value="classic">Classic (+points / −points)</option>
          <option value="casual">Casual (+points / no penalty)</option>
        </select>
      </label>
      <label>
        Answer time
        <select
          value={c.answer_seconds}
          onChange={(e) => void save(c.scoring_mode, Number(e.target.value))}
        >
          {Array.from(new Set([5, 10, 15, 20, 30, 60, c.answer_seconds]))
            .sort((a, b) => a - b)
            .map((n) => (
              <option value={n} key={n}>
                {n} seconds
              </option>
            ))}
        </select>
      </label>
      <ErrorMessage message={error} />
    </fieldset>
  );
}

export function CompetitionControls({
  room,
  onRoom,
  onRefresh,
}: {
  room: RoomState;
  onRoom: (room: RoomState) => void;
  onRefresh: () => void;
}) {
  const game = room.game!;
  const c = game.competition!;
  const attempt = c.attempt;
  const host = room.viewer.role === "host";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [elapsed, setElapsed] = useState<{ sample: string; ms: number } | null>(
    null,
  );
  const answering =
    game.phase === "player_answering" || game.phase === "answer_judging";
  const initial = attempt
    ? Math.max(0, Date.parse(attempt.deadline) - Date.parse(c.server_time))
    : 0;
  const remaining = Math.max(
    0,
    Math.ceil(
      (initial - (elapsed?.sample === c.server_time ? elapsed.ms : 0)) / 1000,
    ),
  );
  useEffect(() => {
    if (
      game.phase !== "player_answering" ||
      !attempt ||
      attempt.outcome !== null
    )
      return;
    const started = performance.now();
    let refreshed = false;
    const timer = setInterval(() => {
      const ms = performance.now() - started;
      setElapsed({ sample: c.server_time, ms });
      if (ms >= initial && !refreshed) {
        refreshed = true;
        onRefresh();
      }
    }, 100);
    return () => clearInterval(timer);
  }, [game.phase, attempt, c.server_time, initial, onRefresh]);
  async function act(
    action: "open" | "close" | "buzz" | "correct" | "incorrect" | "void",
  ) {
    if (busy || !game.active_clue) return;
    setBusy(true);
    setError(null);
    const input = (
      action === "buzz"
        ? { action, clueId: game.active_clue.id, roundId: c.round_id }
        : {
            action,
            clueId: game.active_clue.id,
            expectedVersion: game.version,
            ...(attempt ? { attemptId: attempt.id } : {}),
          }
    ) as GameRequest;
    // Non-judgment actions must not carry an attempt ID (strict API validation).
    if (action === "open" || action === "close")
      delete (input as { attemptId?: string }).attemptId;
    try {
      const result = await api<{ room: RoomState }>(
        `/api/rooms/${room.room_code}/game`,
        input,
      );
      onRoom(result.room);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the round.");
      onRefresh();
    } finally {
      setBusy(false);
      setVoiding(false);
    }
  }
  const open = game.phase === "buzzers_open" || game.phase === "rebound_open";
  const self = room.viewer.player_id;
  const attempted = !!self && c.attempted_player_ids.includes(self);
  const winner = answering && attempt?.player_id === self;
  return (
    <div className="competitive-controls">
      <ErrorMessage message={error} />
      {!room.host_connected && (
        <p role="status" className="input-hint">
          Host reconnecting. The round and scores are saved; the deadline
          continues.
        </p>
      )}
      {answering && attempt && (
        <div className="answer-turn" aria-live="polite">
          <strong>
            {winner
              ? `You’re up!${attempt?.team_name ? ` · ${attempt.team_name}` : ""}`
              : `${attempt.nickname}${attempt.team_name ? ` · ${attempt.team_name}` : ""} buzzed first.`}
          </strong>
          <span
            className="answer-countdown"
            role="timer"
            aria-label="Answer time remaining"
          >
            {game.phase === "answer_judging" ? 0 : remaining}s
          </span>
          <p>
            {remaining > 0 && game.phase !== "answer_judging"
              ? "Answer aloud. The host will judge."
              : "Time is up. Waiting for the host’s judgment."}
          </p>
        </div>
      )}
      {host ? (
        <div className="clue-actions">
          {game.phase === "clue_active" && (
            <Button busy={busy} onClick={() => void act("open")}>
              Open Buzzers
            </Button>
          )}
          {open && (
            <Button
              busy={busy}
              variant="secondary"
              onClick={() => void act("close")}
            >
              Close Buzzers
            </Button>
          )}
          {answering && (
            <>
              <Button
                busy={busy}
                disabled={remaining === 0 || game.phase === "answer_judging"}
                onClick={() => void act("correct")}
              >
                Mark Correct
              </Button>
              <Button
                busy={busy}
                variant="secondary"
                onClick={() => void act("incorrect")}
              >
                Mark Incorrect
              </Button>
              <Button
                disabled={busy}
                variant="ghost"
                onClick={() => setVoiding(true)}
              >
                Void attempt · no penalty
              </Button>
            </>
          )}
        </div>
      ) : (
        game.phase !== "answer_revealed" && (
          <div className="buzzer-panel">
            <button
              type="button"
              className="buzz-button"
              disabled={!open || attempted || busy}
              aria-describedby="buzz-status"
              onClick={() => void act("buzz")}
            >
              {busy ? "SENDING…" : "BUZZ"}
            </button>
            <p id="buzz-status" role="status">
              {busy
                ? "Waiting for server confirmation…"
                : winner
                  ? `You’re up!${attempt?.team_name ? ` · ${attempt.team_name}` : ""}`
                  : attempted
                    ? c.play_mode === "team"
                      ? "Your team has already attempted this clue."
                      : "You’ve already attempted this clue."
                    : open
                      ? "Buzz to answer!"
                      : answering
                        ? `${attempt?.nickname} buzzed first.`
                        : "Waiting for host."}
            </p>
          </div>
        )
      )}
      {open && host && (
        <p role="status">
          {game.phase === "rebound_open"
            ? "Rebound open. Previous attempts are excluded."
            : "Buzzers are open. First accepted server request wins."}
        </p>
      )}
      <ConfirmDialog
        open={voiding}
        title="Void this attempt?"
        description="No points will change. This player (or their entire team in Team Mode) stays ineligible for this clue. Buzzers will close so you can reopen them or reveal the answer."
        busy={busy}
        confirmLabel="Void attempt"
        cancelLabel="Keep answering"
        onCancel={() => setVoiding(false)}
        onConfirm={() => void act("void")}
      />
    </div>
  );
}

function TeamLeaderboard({
  competition,
  final,
}: {
  competition: CompetitionSnapshot;
  final: boolean;
}) {
  const teams = [...(competition.teams ?? [])]
    .filter((t) => t.members.length > 0)
    .sort((a, b) => b.score - a.score || a.position - b.position);
  const winners = teams.filter((t) => t.rank === 1);
  return (
    <Card className="leaderboard">
      <h2>{final ? "Final team rankings" : "Team leaderboard"}</h2>
      {final && winners.length > 0 && (
        <p className="winner-message">
          {winners.length > 1 ? "Shared team victory: " : "Winning team: "}
          {winners.map((t) => t.name).join(" & ")}!
        </p>
      )}
      <div className="team-grid">
        {teams.map((t) => (
          <section key={t.id} className={`team-card team-${t.color}`}>
            <h3>
              #{t.rank} · {t.name}
            </h3>
            <strong className="team-points">
              {t.score.toLocaleString("en-US")} points
            </strong>
            <p>
              {t.correct} correct · {t.incorrect} incorrect
            </p>
            <ul>
              {t.members.map((p) => (
                <li key={p.id}>
                  {p.nickname}
                  {p.left ? " (left)" : ""}
                  <small>
                    {" "}
                    · {p.correct} correct / {p.incorrect} incorrect
                  </small>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="input-hint">
        Team totals determine rank. Member counts show individual contributions,
        not separate scores.
      </p>
    </Card>
  );
}
