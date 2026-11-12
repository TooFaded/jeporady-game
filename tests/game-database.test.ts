import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { hash } from "../src/lib/utils/security";
import type { RoomState } from "../src/types/game";
import type { BoardEditorSnapshot } from "../src/types/board";
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
async function editor(token = host, code = "ABCDEF") {
  return (await game(
    "editor",
    null,
    null,
    token,
    null,
    code,
  )) as unknown as BoardEditorSnapshot;
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
describe("Phase 2 authoritative PostgreSQL game", () => {
  it("creates an independent 5×5 sample board with unique clues and values", async () => {
    const created = await room("create", host, "Host");
    const board = created.game!;
    expect(board.phase).toBe("lobby");
    expect(board.categories.map((c) => c.name)).toEqual([
      "History",
      "Science",
      "Movies",
      "Sports",
      "Random Trivia",
    ]);
    const ids = board.categories.flatMap((c) => c.clues.map((q) => q.id));
    expect(new Set(ids).size).toBe(25);
    for (const category of board.categories)
      expect(category.clues.map((q) => q.value)).toEqual([
        200, 400, 600, 800, 1000,
      ]);
    expect(hasAnswer(created)).toBe(false);
  });
  it("allows only the host to load the answer-bearing editor", async () => {
    await setup();
    expect(hasAnswer(await editor())).toBe(true);
    await expect(editor(player)).rejects.toThrow("HOST_ONLY");
    await expect(editor(hash("forged"))).rejects.toThrow("UNAUTHORIZED");
  });
  it("saves all categories atomically and guards against stale editor saves", async () => {
    await setup();
    const draft = await editor();
    draft.categories[0].name = "New History";
    draft.categories[0].clues[0].question = "An updated question?";
    draft.categories[0].clues[0].answer = "Private custom answer";
    const saved = await game("save", draft.version, null, host, {
      categories: draft.categories,
    });
    expect(saved.game?.version).toBe(1);
    expect(saved.game?.categories[0].name).toBe("New History");
    expect(hasAnswer(saved)).toBe(false);
    expect((await editor()).categories[0].clues[0].answer).toBe(
      "Private custom answer",
    );
    await expect(
      game("save", draft.version, null, host, { categories: draft.categories }),
    ).rejects.toThrow("STALE_GAME");
  });
  it.each([
    "missing-category",
    "missing-clue",
    "empty-answer",
    "duplicate-id",
    "foreign-id",
    "duplicate-name",
  ])("rejects malformed board %s without partial writes", async (kind) => {
    await setup();
    const draft = await editor();
    draft.categories[0].name = "Must roll back";
    if (kind === "missing-category") draft.categories.pop();
    if (kind === "missing-clue") draft.categories[0].clues.pop();
    if (kind === "empty-answer") draft.categories[4].clues[4].answer = "   ";
    if (kind === "duplicate-id")
      draft.categories[0].clues[1].id = draft.categories[0].clues[0].id;
    if (kind === "foreign-id")
      draft.categories[0].clues[0].id = "00000000-0000-4000-8000-000000000000";
    if (kind === "duplicate-name")
      draft.categories[1].name = draft.categories[0].name;
    await expect(
      game("save", 0, null, host, { categories: draft.categories }),
    ).rejects.toThrow("INVALID_BOARD");
    expect((await editor()).categories[0].name).toBe("History");
    expect((await room()).game?.version).toBe(0);
  });
  it("requires a validated complete board before starting", async () => {
    await setup();
    await db.exec(
      "delete from public.game_clues where id=(select id from public.game_clues limit 1)",
    );
    await expect(start()).rejects.toThrow("INVALID_BOARD");
    expect((await room()).status).toBe("lobby");
  });
  it("starts once, preserving the existing session architecture and refusing old unversioned starts", async () => {
    await setup();
    await expect(room("start")).rejects.toThrow("VERSION_REQUIRED");
    const started = await start();
    expect(started.status).toBe("in_progress");
    expect(started.game?.phase).toBe("board");
    await expect(game("start", 0)).rejects.toThrow("STALE_GAME");
    await expect(next("start")).rejects.toThrow("INVALID_TRANSITION");
    expect(
      (await db.query("select * from public.game_sessions")).rows,
    ).toHaveLength(1);
  });
  it("keeps players read-only for every game mutation", async () => {
    await setup();
    const draft = await editor();
    const id = draft.categories[0].clues[0].id;
    for (const action of [
      "save",
      "start",
      "select",
      "reveal",
      "return",
      "complete",
      "end",
    ])
      await expect(
        game(action, 0, id, player, { categories: draft.categories }),
      ).rejects.toThrow("HOST_ONLY");
  });
  it("hides answers in snapshots and broadcasts until the host reveals the active clue", async () => {
    await setup();
    await start();
    const draft = await db.query<{ id: string; answer: string }>(
      "select id,answer from public.game_clues order by id",
    );
    const selected = draft.rows[0];
    const active = await next("select", selected.id);
    expect(active.game?.phase).toBe("clue_active");
    expect(active.game?.active_clue?.question).toBeTruthy();
    expect(hasAnswer(active)).toBe(false);
    expect(hasAnswer(await room("heartbeat", player))).toBe(false);
    const revealed = await next("reveal", selected.id);
    expect(revealed.game?.active_clue?.answer).toBe(selected.answer);
    expect((await room("state", player)).game?.active_clue?.answer).toBe(
      selected.answer,
    );
    const events = await db.query<{ payload: unknown }>(
      "select payload from realtime.test_events",
    );
    expect(
      events.rows.every(
        (row) => JSON.stringify(row.payload) === '{"changed":true}',
      ),
    ).toBe(true);
  });
  it("rejects wrong-phase actions, duplicate selection and mismatched active clue IDs", async () => {
    await setup();
    const board = (await start()).game!;
    const [a, b] = board.categories[0].clues;
    await expect(next("reveal", a.id)).rejects.toThrow("CLUE_UNAVAILABLE");
    const active = await next("select", a.id);
    await expect(game("select", board.version, b.id)).rejects.toThrow(
      "STALE_GAME",
    );
    await expect(next("select", b.id)).rejects.toThrow("INVALID_TRANSITION");
    await expect(next("complete", a.id)).rejects.toThrow("INVALID_TRANSITION");
    await expect(next("reveal", b.id)).rejects.toThrow("CLUE_UNAVAILABLE");
    expect((await room()).game?.version).toBe(active.game?.version);
  });
  it("returns an unrevealed clue to the board, completes a revealed clue once, and prevents replay", async () => {
    await setup();
    const id = (await start()).game!.categories[0].clues[0].id;
    await next("select", id);
    const returned = await next("return", id);
    expect(returned.game?.phase).toBe("board");
    expect(returned.game?.completed_count).toBe(0);
    await next("select", id);
    await next("reveal", id);
    await expect(next("return", id)).rejects.toThrow("INVALID_TRANSITION");
    const completed = await next("complete", id);
    expect(completed.game?.completed_count).toBe(1);
    expect(completed.game?.categories[0].clues[0].completed).toBe(true);
    expect(hasAnswer(completed)).toBe(false);
    await expect(next("select", id)).rejects.toThrow("CLUE_UNAVAILABLE");
    await expect(next("complete", id)).rejects.toThrow("CLUE_UNAVAILABLE");
  });
  it("recovers the exact phase after refresh and reconnection", async () => {
    await setup();
    const id = (await start()).game!.categories[0].clues[0].id;
    for (const action of ["select", "reveal", "complete"]) {
      const changed = await next(action, id);
      expect((await room("heartbeat", player)).game).toEqual(changed.game);
      expect((await room()).game).toEqual(changed.game);
    }
  });
  it("automatically completes after all 25 clues without awarding scores", async () => {
    await setup();
    const initial = await start();
    const clues = initial.game!.categories.flatMap((c) => c.clues);
    let current = initial;
    for (const clue of clues) {
      current = await game("select", current.game!.version, clue.id);
      current = await game("reveal", current.game!.version, clue.id);
      current = await game("complete", current.game!.version, clue.id);
    }
    expect(current.status).toBe("completed");
    expect(current.game?.phase).toBe("completed");
    expect(current.game?.completed_count).toBe(25);
    expect(current.game?.ended_early).toBe(false);
    expect(current.game?.participants).toHaveLength(1);
    expect(current.players[0].score).toBe(0);
    expect(current.game?.active_clue).toBeNull();
    expect((await room("heartbeat", player)).game).toEqual(current.game);
  });
  it("ends early from an active clue and preserves final state when host leaves", async () => {
    await setup();
    const id = (await start()).game!.categories[0].clues[0].id;
    await next("select", id);
    const ended = await next("end");
    expect(ended.game?.ended_early).toBe(true);
    expect(ended.game?.active_clue).toBeNull();
    expect(ended.game?.completed_count).toBe(0);
    await expect(next("select", id)).rejects.toThrow("INVALID_TRANSITION");
    await room("leave");
    expect((await room("state", player)).game).toEqual(ended.game);
  });
  it("isolates rooms and refuses cross-room clues, credentials and editor IDs", async () => {
    await setup();
    const other = hash("other-host");
    await room("create", other, "Other", "GHJKLM");
    const second = await editor(other, "GHJKLM");
    const first = await editor();
    expect(first.id).not.toBe(second.id);
    await expect(
      game("save", 0, null, host, { categories: second.categories }),
    ).rejects.toThrow("INVALID_BOARD");
    await expect(game("end", 0, null, other, null, "ABCDEF")).rejects.toThrow(
      "UNAUTHORIZED",
    );
    await start();
    await expect(
      next("select", second.categories[0].clues[0].id),
    ).rejects.toThrow("CLUE_UNAVAILABLE");
    expect((await room("state", other, null, "GHJKLM")).game?.phase).toBe(
      "lobby",
    );
  });
  it("enforces table, sample-key, snapshot helper and internal RPC permissions", async () => {
    await setup();
    await db.exec("set role authenticated");
    for (const query of [
      "select * from public.game_clues",
      "select public.sample_game_board()",
      "select public.game_snapshot(gen_random_uuid())",
      "select public.room_command_phase_one('state','ABCDEF','x',null)",
    ])
      await expect(db.query(query)).rejects.toThrow("permission denied");
    await expect(game("editor", null)).rejects.toThrow("permission denied");
    await db.exec("reset role;set role service_role");
    await expect(db.query("select public.sample_game_board()")).rejects.toThrow(
      "permission denied",
    );
  });
  it("publishes no event on a failed or replayed transaction", async () => {
    await setup();
    await start();
    const before = (await db.query("select * from realtime.test_events")).rows
      .length;
    await expect(game("start", 0)).rejects.toThrow("STALE_GAME");
    expect(
      (await db.query("select * from realtime.test_events")).rows,
    ).toHaveLength(before);
  });
});
