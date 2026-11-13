import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { hash } from "../src/lib/utils/security";
import type { RoomState } from "../src/types/game";
let db: PGlite;
const host = hash("phase2-host"),
  player = hash("phase2-player");
async function room(
  action = "state",
  token = host,
  name: string | null = null,
  code = "ABCDEF",
) {
  const result = await db.query<{ result: RoomState }>(
    "select public.room_command($1,$2,$3,$4) result",
    [action, code, token, name],
  );
  return result.rows[0].result;
}
async function game(
  action: string,
  version: number | null,
  clue: string | null = null,
  token = host,
  board: unknown = null,
  code = "ABCDEF",
) {
  const result = await db.query<{ result: RoomState }>(
    "select public.game_command($1,$2,$3,$4,$5,$6::jsonb) result",
    [
      code,
      token,
      action,
      version,
      clue,
      board === null ? null : JSON.stringify(board),
    ],
  );
  return result.rows[0].result;
}
async function setup() {
  await room("create", host, "Host");
  await room("join", player, "Player");
}
async function start() {
  return game("start", (await room()).game!.version);
}
async function next(action: string, clue: string | null = null) {
  return game(action, (await room()).game!.version, clue);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create schema realtime;
 create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function realtime.topic() returns text language sql as $$select current_setting('realtime.topic',true)$$;
 create table realtime.messages(extension text);alter table realtime.messages enable row level security;
 create table realtime.test_events(payload jsonb,event text,topic text,private boolean);
 create function realtime.send(jsonb,text,text,boolean) returns void language sql as $$insert into realtime.test_events values($1,$2,$3,$4)$$;
 grant usage on schema auth,realtime to authenticated;grant select,insert on realtime.messages to authenticated;`);
  for (const file of [
    "202611120001_phase_one.sql",
    "202611120002_game_board.sql",
    "202611120003_competition.sql",
    "202611120004_teams.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
});
beforeEach(async () => {
  await db.exec(
    "reset role;truncate public.game_rooms,public.request_limits,realtime.test_events cascade;",
  );
});
afterAll(async () => {
  await db?.close();
});

const second = hash("second-player");
async function compete(
  action: string,
  token = host,
  opts: {
    version?: number;
    clue?: string;
    round?: string;
    attempt?: string;
    mode?: string;
    seconds?: number;
    code?: string;
  } = {},
) {
  const code = opts.code ?? "ABCDEF";
  const state = await room("state", token, null, code);
  const g = state.game!;
  const result = await db.query<{ result: RoomState }>(
    "select public.competition_command($1,$2,$3,$4,$5,$6,$7,$8,$9) result",
    [
      code,
      token,
      action,
      opts.version ?? g.version,
      opts.clue ?? g.active_clue?.id ?? null,
      opts.round ?? g.competition?.round_id ?? null,
      opts.attempt ?? g.competition?.attempt?.id ?? null,
      opts.mode ?? null,
      opts.seconds ?? null,
    ],
  );
  return result.rows[0].result;
}
async function team(
  action: string,
  data: object = {},
  token = host,
  code = "ABCDEF",
) {
  const state = await room("state", token, null, code);
  const result = await db.query<{ result: RoomState }>(
    "select public.team_command($1,$2,$3,$4,$5::jsonb) result",
    [code, token, action, state.game!.version, JSON.stringify(data)],
  );
  return result.rows[0].result;
}
async function teamSetup(count = 2, capacity = 8) {
  await setup();
  await room("join", second, "Second");
  return team("team_setup", { mode: "team", count, capacity });
}
async function teamStarted() {
  await teamSetup();
  await room("join", hash("third"), "Third");
  await team("balance_teams");
  await team("team_lock", { locked: true });
  await start();
  const g = (await room()).game!;
  await next("select", g.categories[0].clues[0].id);
  return compete("open");
}
describe("Team Mode SQL", () => {
  it("creates 2–4 distinct room-scoped teams, edits names/colors and keeps solo default", async () => {
    await setup();
    expect((await room()).game!.competition!.play_mode).toBe("solo");
    const state = await team("team_setup", {
      mode: "team",
      count: 4,
      capacity: 4,
    });
    const teams = state.game!.competition!.teams!;
    expect(teams).toHaveLength(4);
    expect(new Set(teams.map((t) => t.color)).size).toBe(4);
    await team("team_edit", {
      teamId: teams[0].id,
      name: "Wizards",
      color: "teal",
    });
    await expect(
      team("team_edit", {
        teamId: teams[1].id,
        name: "wizards",
        color: "rose",
      }),
    ).rejects.toThrow("TEAM_DISTINCT");
    await expect(
      team("team_edit", { teamId: teams[1].id, name: "Other", color: "teal" }),
    ).rejects.toThrow("TEAM_DISTINCT");
  });
  it("balances deterministically, enforces capacity and rolls back impossible balance", async () => {
    await teamSetup(2, 1);
    await room("join", hash("third"), "Third");
    await expect(team("balance_teams")).rejects.toThrow("TEAM_FULL");
    await team("team_setup", { mode: "team", count: 2, capacity: 2 });
    const state = await team("balance_teams");
    expect(
      state.game!.competition!.teams!.map((t) => t.members.length),
    ).toEqual([2, 1]);
    const teams = state.game!.competition!.teams!;
    await expect(
      team("choose_team", { teamId: teams[0].id }, second),
    ).rejects.toThrow("TEAM_FULL");
    await expect(
      team("team_setup", { mode: "team", count: 2, capacity: 1 }),
    ).rejects.toThrow("TEAM_FULL");
    expect((await room()).game!.competition!.team_capacity).toBe(2);
  });
  it("allows only self-selection, permits host moves, locks players and rejects unassigned starts", async () => {
    const state = await teamSetup();
    const teams = state.game!.competition!.teams!;
    await team("choose_team", { teamId: teams[0].id }, player);
    await expect(
      team(
        "assign_team",
        { teamId: teams[1].id, playerId: state.players[0].id },
        second,
      ),
    ).rejects.toThrow("HOST_ONLY");
    await expect(start()).rejects.toThrow("TEAMS_UNLOCKED");
    await team("team_lock", { locked: true });
    await expect(start()).rejects.toThrow("TEAM_UNASSIGNED");
    await expect(
      team("choose_team", { teamId: teams[1].id }, second),
    ).rejects.toThrow("TEAMS_LOCKED");
    await team("assign_team", {
      teamId: teams[1].id,
      playerId: state.players[1].id,
    });
    await start();
    await expect(team("team_lock", { locked: false })).rejects.toThrow(
      "TEAMS_FROZEN",
    );
    await expect(
      team("choose_team", { teamId: teams[0].id }, second),
    ).rejects.toThrow("TEAMS_FROZEN");
  });
  it("excludes the whole failed team, scores its ledger once and allows another team rebound", async () => {
    await teamStarted();
    const won = await compete("buzz", player);
    expect(won.game!.competition!.attempt!.team_name).toBe("Team 1");
    const failed = await compete("incorrect");
    expect(failed.game!.competition!.teams![0]).toMatchObject({
      score: -200,
      incorrect: 1,
    });
    expect(failed.players.every((p) => p.score === 0)).toBe(true);
    await expect(compete("buzz", hash("third"))).rejects.toThrow(
      "BUZZ_INELIGIBLE",
    );
    await compete("buzz", second);
    const pending = (await room()).game!;
    await compete("correct");
    await expect(
      compete("correct", host, {
        version: pending.version,
        attempt: pending.competition!.attempt!.id,
      }),
    ).rejects.toThrow("STALE_GAME");
    await next("end");
    const teams = (await room()).game!.competition!.teams!;
    expect(teams[1]).toMatchObject({ score: 200, rank: 1, correct: 1 });
    expect(teams[0].rank).toBe(2);
  });
  it("casual wrong answers score zero and final ties share rank", async () => {
    await teamSetup();
    await compete("configure", host, { mode: "casual", seconds: 10 });
    await team("balance_teams");
    await team("team_lock", { locked: true });
    await start();
    const g = (await room()).game!;
    await next("select", g.categories[0].clues[0].id);
    await compete("open");
    await compete("buzz", player);
    await compete("incorrect");
    await next("end");
    expect(
      (await room()).game!.competition!.teams!.map((t) => [t.score, t.rank]),
    ).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });
  it("arbitrates concurrent teammates/opponents with one accepted attempt", async () => {
    const state = await teamStarted();
    const g = state.game!;
    const results = await Promise.allSettled(
      [player, second, hash("third")].map((token) =>
        db.query("select public.competition_command($1,$2,'buzz',null,$3,$4)", [
          "ABCDEF",
          token,
          g.active_clue!.id,
          g.competition!.round_id,
        ]),
      ),
    );
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(
      (await db.query("select * from public.answer_attempts")).rows,
    ).toHaveLength(1);
  });
  it("rejects cross-room assignments and protects team table/helper access", async () => {
    const first = await teamSetup();
    const other = hash("other");
    await room("create", other, "Other", "GHJKLM");
    const secondRoom = await team(
      "team_setup",
      { mode: "team", count: 2, capacity: 8 },
      other,
      "GHJKLM",
    );
    await expect(
      team(
        "choose_team",
        { teamId: secondRoom.game!.competition!.teams![0].id },
        player,
      ),
    ).rejects.toThrow("INVALID_TEAM");
    await expect(
      team(
        "assign_team",
        {
          teamId: secondRoom.game!.competition!.teams![0].id,
          playerId: first.players[0].id,
        },
        other,
        "GHJKLM",
      ),
    ).rejects.toThrow("INVALID_TEAM");
    await db.exec("set role authenticated");
    await expect(db.query("select * from public.game_teams")).rejects.toThrow(
      "permission denied",
    );
    await expect(db.query("select public.team_snapshot(null)")).rejects.toThrow(
      "permission denied",
    );
  });
  it("retains departed contributions and resets eligibility for each new clue", async () => {
    await teamStarted();
    await compete("buzz", player);
    await compete("correct");
    const state = await room();
    await next("complete", state.game!.active_clue!.id);
    await room("leave", player);
    const teamState = (await room()).game!.competition!.teams![0];
    expect(teamState.score).toBe(200);
    expect(teamState.members.find((p) => p.nickname === "Player")!.left).toBe(
      true,
    );
    await next("select", state.game!.categories[0].clues[1].id);
    await compete("open");
    await compete("buzz", hash("third"));
  });
  it("does not rank empty teams ahead of participating teams with negative scores", async () => {
    await teamSetup(4, 4);
    await team("balance_teams");
    await team("team_lock", { locked: true });
    await start();
    const g = (await room()).game!;
    await next("select", g.categories[0].clues[0].id);
    await compete("open");
    await compete("buzz", player);
    await compete("incorrect");
    await next("end");
    const teams = (await room()).game!.competition!.teams!;
    expect(teams[1].rank).toBe(1);
    expect(teams[0].rank).toBe(2);
    expect(teams[2].rank).toBeGreaterThan(2);
  });
  it("changing count clears assignments, while Solo Mode can start without team locks", async () => {
    await teamSetup();
    await team("balance_teams");
    const state = await team("team_setup", {
      mode: "team",
      count: 3,
      capacity: 8,
    });
    expect(
      state.game!.competition!.teams!.every((t) => t.members.length === 0),
    ).toBe(true);
    await team("team_setup", { mode: "solo", count: 3, capacity: 8 });
    await start();
    expect((await room()).game!.phase).toBe("board");
  });
});
