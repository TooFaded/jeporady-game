"use client";
import { useState } from "react";
import { Button, Card, ErrorMessage } from "@/components/ui";
import { api } from "@/features/lobby/api";
import type { RoomState } from "@/types/game";
const colors = [
  "blue",
  "gold",
  "purple",
  "green",
  "teal",
  "rose",
  "orange",
  "indigo",
];
export function TeamLobby({
  room,
  onRoom,
  onRefresh,
}: {
  room: RoomState;
  onRoom: (r: RoomState) => void;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = room.game?.competition;
  const host = room.viewer.role === "host";
  if (!c?.play_mode)
    return host ? (
      <p className="input-hint">Apply migration 004 to enable Team Mode.</p>
    ) : null;
  const teams = c.teams ?? [];
  const self = teams.find((t) =>
    t.members.some((p) => p.id === room.viewer.player_id),
  );
  async function act(data: object) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ room: RoomState }>(
        `/api/rooms/${room.room_code}/game`,
        { ...data, expectedVersion: room.game!.version },
      );
      onRoom(result.room);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update teams.");
      onRefresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="team-lobby">
      <h2>
        {c.play_mode === "team" ? "Choose your crew." : "Solo or together?"}
      </h2>
      <ErrorMessage message={error} />
      {host && (
        <form
          key={`${c.play_mode}-${teams.length}-${c.team_capacity}`}
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            void act({
              action: "team_setup",
              mode: d.get("mode"),
              count: Number(d.get("count")),
              capacity: Number(d.get("capacity")),
            });
          }}
        >
          <fieldset disabled={busy} className="team-settings">
            <legend>Game mode</legend>
            <label>
              Mode
              <select name="mode" defaultValue={c.play_mode}>
                <option value="solo">Solo Mode</option>
                <option value="team">Team Mode</option>
              </select>
            </label>
            <label>
              Teams
              <select name="count" defaultValue={teams.length || 2}>
                {[2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Players per team
              <input
                name="capacity"
                type="number"
                min={1}
                max={room.settings.max_players}
                defaultValue={c.team_capacity ?? 8}
                required
              />
            </label>
            <Button busy={busy} type="submit">
              Save mode & capacity
            </Button>
          </fieldset>
          <p className="input-hint">
            Changing the team count resets assignments. Saving settings unlocks
            team selection.
          </p>
        </form>
      )}
      {c.play_mode === "team" && (
        <>
          <p role="status">
            {c.teams_locked
              ? "Team selection is locked. The host can adjust assignments before starting."
              : "Players can choose a team. The host locks selection before starting."}
          </p>
          {host && (
            <div className="setup-actions">
              <Button
                busy={busy}
                variant="secondary"
                onClick={() => void act({ action: "balance_teams" })}
              >
                Distribute evenly
              </Button>
              <Button
                busy={busy}
                onClick={() =>
                  void act({ action: "team_lock", locked: !c.teams_locked })
                }
              >
                {c.teams_locked ? "Unlock selection" : "Lock selection"}
              </Button>
            </div>
          )}
          <div className="team-grid">
            {teams.map((t) => (
              <section key={t.id} className={`team-card team-${t.color}`}>
                <h3>{t.name}</h3>
                <p>
                  {t.members.filter((p) => !p.left).length} / {c.team_capacity}{" "}
                  players
                </p>
                <ul>
                  {t.members
                    .filter((p) => !p.left)
                    .map((p) => (
                      <li key={p.id}>
                        {p.nickname}
                        {p.id === room.viewer.player_id ? " · you" : ""}
                      </li>
                    ))}
                </ul>
                {host ? (
                  <form
                    key={`${t.name}-${t.color}`}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const d = new FormData(e.currentTarget);
                      void act({
                        action: "team_edit",
                        teamId: t.id,
                        name: d.get("name"),
                        color: d.get("color"),
                      });
                    }}
                  >
                    <fieldset disabled={busy}>
                      <label>
                        Team name
                        <input
                          name="name"
                          defaultValue={t.name}
                          maxLength={32}
                          required
                        />
                      </label>
                      <label>
                        Color
                        <select name="color" defaultValue={t.color}>
                          {colors.map((color) => (
                            <option
                              key={color}
                              value={color}
                              disabled={teams.some(
                                (other) =>
                                  other.id !== t.id && other.color === color,
                              )}
                            >
                              {color}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button variant="secondary" busy={busy} type="submit">
                        Save team
                      </Button>
                    </fieldset>
                  </form>
                ) : (
                  <Button
                    busy={busy}
                    disabled={
                      c.teams_locked ||
                      self?.id === t.id ||
                      t.members.filter((p) => !p.left).length >=
                        (c.team_capacity ?? 16)
                    }
                    onClick={() =>
                      void act({ action: "choose_team", teamId: t.id })
                    }
                  >
                    {self?.id === t.id ? "Your team" : "Join team"}
                  </Button>
                )}
              </section>
            ))}
          </div>
          <div className="team-assignments">
            <h3>{host ? "Player assignments" : "Waiting for a team"}</h3>
            {room.players
              .filter(
                (p) =>
                  host ||
                  !teams.some((t) => t.members.some((m) => m.id === p.id)),
              )
              .map((p) => (
                <div key={p.id}>
                  <span>{p.nickname}</span>
                  {host && (
                    <select
                      aria-label={`Team for ${p.nickname}`}
                      disabled={busy}
                      value={
                        teams.find((t) => t.members.some((m) => m.id === p.id))
                          ?.id ?? ""
                      }
                      onChange={(e) =>
                        void act({
                          action: "assign_team",
                          playerId: p.id,
                          teamId: e.target.value || null,
                        })
                      }
                    >
                      <option value="">Unassigned</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
          </div>
        </>
      )}
      {c.play_mode === "solo" && !host && (
        <p>Solo Mode · each player competes individually.</p>
      )}
    </Card>
  );
}
