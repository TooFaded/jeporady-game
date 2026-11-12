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
const hasAnswer = (value: unknown): boolean =>
  !!value &&
  typeof value === "object" &&
  (Object.keys(value).includes("answer") ||
    Object.values(value).some(hasAnswer));
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
async function opened() {
  await setup();
  await room("join", second, "Second");
  await start();
  const g = (await room()).game!;
  await next("select", g.categories[0].clues[0].id);
  return compete("open");
}
async function expire() {
  await db.exec(
    "update public.answer_attempts set accepted_at=clock_timestamp()-interval '20 seconds',deadline=clock_timestamp()-interval '1 second' where outcome is null",
  );
}
describe("Phase 3 PostgreSQL competition", () => {
  it("serializes competing buzz calls with exactly one persisted winner", async () => {
    const state = await opened();
    const g = state.game!;
    const args = [g.active_clue!.id, g.competition!.round_id];
    // Real SQL, queued by PGlite's single connection. Live multi-connection test is separate.
    const results = await Promise.allSettled(
      [player, second].map((token) =>
        db.query("select public.competition_command($1,$2,'buzz',null,$3,$4)", [
          "ABCDEF",
          token,
          ...args,
        ]),
      ),
    );
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(
      (await db.query("select * from public.answer_attempts")).rows,
    ).toHaveLength(1);
    expect((await room()).game!.phase).toBe("player_answering");
  });
  it("rejects duplicate buzz, host buzz, and stale round tokens", async () => {
    const old = await opened();
    await compete("close");
    await compete("open");
    await expect(
      compete("buzz", player, { round: old.game!.competition!.round_id! }),
    ).rejects.toThrow("BUZZ_CLOSED");
    await expect(compete("buzz", host)).rejects.toThrow("PLAYER_ONLY");
    await compete("buzz", player);
    await expect(compete("buzz", player)).rejects.toThrow("BUZZ_CLOSED");
    await expect(compete("buzz", second)).rejects.toThrow("BUZZ_CLOSED");
  });
  it("awards exactly once, ends competition, and keeps next clue host-controlled", async () => {
    await opened();
    await compete("buzz", player);
    const before = (await room()).game!;
    const judged = await compete("correct");
    expect(judged.game!.phase).toBe("answer_revealed");
    expect(judged.game!.competition!.leaderboard[0]).toMatchObject({
      score: 200,
      correct: 1,
      incorrect: 0,
      rank: 1,
    });
    await expect(
      compete("correct", host, {
        version: before.version,
        attempt: before.competition!.attempt!.id,
      }),
    ).rejects.toThrow("STALE_GAME");
    await expect(compete("open")).rejects.toThrow("INVALID_TRANSITION");
    await next("complete", before.active_clue!.id);
    expect((await room()).game!.phase).toBe("board");
  });
  it.each(["classic", "casual"])(
    "applies %s penalties and excludes prior attempts on rebound",
    async (mode) => {
      await setup();
      await room("join", second, "Second");
      await compete("configure", host, { mode, seconds: 10 });
      await start();
      const g = (await room()).game!;
      await next("select", g.categories[0].clues[0].id);
      await compete("open");
      await compete("buzz", player);
      const incorrect = await compete("incorrect");
      expect(incorrect.game!.phase).toBe("rebound_open");
      expect(
        incorrect.game!.competition!.leaderboard.find(
          (p) => p.nickname === "Player",
        ),
      ).toMatchObject({ score: mode === "classic" ? -200 : 0, incorrect: 1 });
      await expect(compete("buzz", player)).rejects.toThrow("BUZZ_INELIGIBLE");
      await compete("buzz", second);
      await compete("incorrect");
      expect((await room()).game!.phase).toBe("clue_active");
      await expect(compete("open")).rejects.toThrow("NO_ELIGIBLE_PLAYERS");
      await expect(next("return", g.categories[0].clues[0].id)).rejects.toThrow(
        "ROUND_PLAYED",
      );
      await next("reveal", g.categories[0].clues[0].id);
      await next("complete", g.categories[0].clues[0].id);
      await next("select", g.categories[0].clues[1].id);
      await compete("open");
      await compete("buzz", player);
    },
  );
  it("persists deadlines across refresh, transitions expired answers, rejects late correct and permits incorrect", async () => {
    await opened();
    const won = await compete("buzz", player);
    const deadline = won.game!.competition!.attempt!.deadline;
    expect(
      Date.parse(deadline) - Date.parse(won.game!.competition!.server_time),
    ).toBeGreaterThan(9000);
    expect(
      (await room("heartbeat", player)).game!.competition!.attempt!.deadline,
    ).toBe(deadline);
    await expire();
    expect((await room()).game!.phase).toBe("answer_judging");
    await expect(compete("correct")).rejects.toThrow("ANSWER_EXPIRED");
    await compete("incorrect");
    expect(
      (await room()).game!.competition!.leaderboard.find(
        (p) => p.nickname === "Player",
      )!.score,
    ).toBe(-200);
  });
  it("allows no-penalty recovery for disconnected winner without resetting attempts", async () => {
    await opened();
    await compete("buzz", player);
    await room("leave", player);
    await compete("void");
    const state = await room();
    expect(state.game!.phase).toBe("clue_active");
    expect(
      state.game!.competition!.leaderboard.find((p) => p.nickname === "Player")!
        .score,
    ).toBe(0);
    await compete("open");
    await compete("buzz", second);
  });
  it("rejects disconnected/expired/revoked sessions and player judging", async () => {
    await opened();
    await db.exec(
      "update public.game_players set last_seen_at=clock_timestamp()-interval '1 minute'",
    );
    await expect(compete("buzz", player)).rejects.toThrow("BUZZ_INELIGIBLE");
    await room("heartbeat", player);
    await compete("buzz", player);
    await expect(compete("correct", player)).rejects.toThrow("HOST_ONLY");
    await room("leave", second);
    await expect(compete("buzz", second)).rejects.toThrow("UNAUTHORIZED");
    await db.exec(
      "update public.game_rooms set expires_at=clock_timestamp()-interval '1 second'",
    );
    await expect(compete("incorrect")).rejects.toThrow("UNAUTHORIZED");
  });
  it("preserves host disconnect state and safe final rankings with ties", async () => {
    await opened();
    await compete("buzz", player);
    const won = await room();
    await db.exec(
      "update public.room_credentials set last_seen_at=clock_timestamp()-interval '1 minute' where role='host'",
    );
    const restored = await room("heartbeat", player);
    expect(restored.host_connected).toBe(false);
    expect(restored.game!.competition!.attempt).toEqual(
      won.game!.competition!.attempt,
    );
    await room("heartbeat", host);
    await compete("void");
    await next("end");
    const final = await room();
    expect(final.game!.competition!.leaderboard.map((p) => p.rank)).toEqual([
      1, 1,
    ]);
    expect(final.game!.competition!.leaderboard.map((p) => p.nickname)).toEqual(
      ["Player", "Second"],
    );
  });
  it("isolates rooms and keeps answer keys and internal RPCs private", async () => {
    await opened();
    const other = hash("other-host");
    await room("create", other, "Other", "GHJKLM");
    await expect(compete("buzz", player, { code: "GHJKLM" })).rejects.toThrow(
      "UNAUTHORIZED",
    );
    await compete("buzz", player);
    expect(hasAnswer(await room("state", player))).toBe(false);
    const events = await db.query<{ payload: unknown }>(
      "select payload from realtime.test_events",
    );
    expect(events.rows.every((e) => !hasAnswer(e.payload))).toBe(true);
    await db.exec("set role authenticated");
    await expect(
      db.query("select * from public.answer_attempts"),
    ).rejects.toThrow("permission denied");
    await expect(
      db.query("select public.competition_snapshot(null)"),
    ).rejects.toThrow("permission denied");
    await db.exec("reset role");
  });
  it("persists configured timer and disallows settings changes after starting", async () => {
    await setup();
    await compete("configure", host, { mode: "casual", seconds: 20 });
    await start();
    const g = (await room()).game!;
    await next("select", g.categories[0].clues[0].id);
    await compete("open");
    const won = await compete("buzz", player);
    expect(
      Date.parse(won.game!.competition!.attempt!.deadline) -
        Date.parse(won.game!.competition!.server_time),
    ).toBeGreaterThan(19000);
    await expect(
      compete("configure", host, { mode: "classic", seconds: 10 }),
    ).rejects.toThrow("INVALID_TRANSITION");
  });
  it("voids pending attempt on early end and cannot award later", async () => {
    await opened();
    await compete("buzz", player);
    await next("end");
    expect((await room()).game!.phase).toBe("completed");
    await expect(compete("correct")).rejects.toThrow("INVALID_TRANSITION");
    expect(
      (
        await db.query<{ outcome: string }>(
          "select outcome from public.answer_attempts",
        )
      ).rows[0].outcome,
    ).toBe("void");
  });
  it("gives only the host a judging reference and emits expiry once", async () => {
    await opened();
    expect((await room()).game!.host_answer).toBeTruthy();
    expect((await room("state", player)).game).not.toHaveProperty(
      "host_answer",
    );
    await compete("buzz", player);
    await expire();
    await db.exec("truncate realtime.test_events");
    const expired = await room();
    await room("heartbeat", player);
    await room();
    expect(expired.game!.phase).toBe("answer_judging");
    expect(
      (await db.query("select * from realtime.test_events")).rows,
    ).toHaveLength(1);
    expect((await room("state", player)).game).not.toHaveProperty(
      "host_answer",
    );
  });
  it("rejects a judgment targeting an earlier attempt and permits room cleanup", async () => {
    await opened();
    const first = await compete("buzz", player);
    await compete("incorrect");
    await compete("buzz", second);
    await expect(
      compete("correct", host, {
        attempt: first.game!.competition!.attempt!.id,
      }),
    ).rejects.toThrow("INVALID_TRANSITION");
    await db.exec("delete from public.game_rooms");
    expect(
      (await db.query("select * from public.answer_attempts")).rows,
    ).toHaveLength(0);
  });
});
