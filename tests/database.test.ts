import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { hash } from "../src/lib/utils/security";
import type { RoomState } from "../src/types/game";
let db: PGlite;
const host = hash("host"),
  player = hash("player");
async function command(
  action: string,
  token = host,
  name: string | null = null,
  code = "ABCDEF",
) {
  const result = await db.query<{ result: RoomState }>(
    "select public.room_command($1,$2,$3,$4) as result",
    [action, code, token, name],
  );
  return result.rows[0].result;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema auth; create schema realtime;
 create function auth.jwt() returns jsonb language sql as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 create function realtime.topic() returns text language sql as $$ select current_setting('realtime.topic',true) $$;
 create function realtime.send(jsonb,text,text,boolean) returns void language sql as $$ select $$;
 create table realtime.messages (extension text); alter table realtime.messages enable row level security;
 grant usage on schema realtime, auth to authenticated; grant select,insert on realtime.messages to authenticated;`);
  await db.exec(
    readFileSync("supabase/migrations/202611120001_phase_one.sql", "utf8"),
  );
});
beforeEach(async () => {
  await db.exec(
    "reset role; truncate public.game_rooms,public.request_limits cascade;",
  );
});
afterAll(async () => {
  await db?.close();
});
describe("PostgreSQL room transactions", () => {
  it("creates room with a host credential and default settings", async () => {
    const room = await command("create", host, "Alex");
    expect(room.status).toBe("lobby");
    expect(room.viewer.role).toBe("host");
    expect(room.settings.max_players).toBe(16);
    expect(room.players).toEqual([]);
  });
  it("enforces active room-code uniqueness", async () => {
    await command("create", host, "Alex");
    await expect(command("create", hash("another"), "Sam")).rejects.toThrow(
      "CODE_TAKEN",
    );
  });
  it("allows reuse of expired codes without giving the former host access", async () => {
    await command("create", host, "Alex");
    await db.exec(
      "update public.game_rooms set expires_at=now()-interval '1 second'",
    );
    await command("create", hash("newhost"), "Sam");
    await expect(command("state", host)).rejects.toThrow("UNAUTHORIZED");
  });
  it("rejects nonexistent rooms", async () => {
    await expect(command("join", player, "Sam")).rejects.toThrow("NOT_FOUND");
  });
  it("joins and rejects case-insensitive duplicate active nicknames", async () => {
    await command("create", host, "Alex");
    const room = await command("join", player, "Sam");
    expect(room.players[0].nickname).toBe("Sam");
    expect(room.viewer.role).toBe("player");
    await expect(command("join", hash("other"), "sAM")).rejects.toThrow(
      "DUPLICATE_NAME",
    );
  });
  it("enforces capacity in the database", async () => {
    await command("create", host, "Alex");
    await db.exec(`update public.game_rooms set settings='{"max_players":1}'`);
    await command("join", player, "Sam");
    await expect(command("join", hash("other"), "Jo")).rejects.toThrow("FULL");
  });
  it("authorizes host-only start and transitions exactly once", async () => {
    await command("create", host, "Alex");
    await command("join", player, "Sam");
    await expect(command("start", player)).rejects.toThrow("HOST_ONLY");
    const room = await command("start");
    expect(room.status).toBe("in_progress");
    await expect(command("start")).rejects.toThrow("CLOSED");
    await expect(command("join", hash("late"), "Late")).rejects.toThrow(
      "CLOSED",
    );
    const sessions = await db.query("select * from public.game_sessions");
    expect(sessions.rows).toHaveLength(1);
  });
  it("requires a connected player to start", async () => {
    await command("create", host, "Alex");
    await expect(command("start")).rejects.toThrow("EMPTY_ROOM");
  });
  it("rejects unknown credentials and room-code-only authorization", async () => {
    await command("create", host, "Alex");
    await expect(command("state", hash("ABCDEF"))).rejects.toThrow(
      "UNAUTHORIZED",
    );
    await expect(command("start", hash("forged"))).rejects.toThrow(
      "UNAUTHORIZED",
    );
  });
  it("expires disconnected players and restores them on heartbeat", async () => {
    await command("create", host, "Alex");
    await command("join", player, "Sam");
    await db.exec(
      "update public.game_players set last_seen_at=now()-interval '46 seconds'",
    );
    expect((await command("state")).players[0].is_connected).toBe(false);
    expect((await command("heartbeat", player)).players[0].is_connected).toBe(
      true,
    );
  });
  it("revokes a leaving player and frees their nickname", async () => {
    await command("create", host, "Alex");
    await command("join", player, "Sam");
    await command("leave", player);
    await expect(command("state", player)).rejects.toThrow("UNAUTHORIZED");
    expect((await command("state")).players).toHaveLength(0);
    expect((await command("join", hash("rejoin"), "Sam")).players).toHaveLength(
      1,
    );
  });
  it("host departure cancels room and revokes all credentials", async () => {
    await command("create", host, "Alex");
    await command("join", player, "Sam");
    await command("leave");
    await expect(command("state", player)).rejects.toThrow("UNAUTHORIZED");
    await expect(command("join", hash("new"), "Jo")).rejects.toThrow("CLOSED");
  });
  it("denies browser table reads, score changes, and service RPCs", async () => {
    await command("create", host, "Alex");
    await db.exec("set role authenticated");
    await expect(
      db.query("select * from public.room_credentials"),
    ).rejects.toThrow("permission denied");
    await expect(
      db.query("update public.game_players set score=999"),
    ).rejects.toThrow("permission denied");
    await expect(command("create", host, "Alex")).rejects.toThrow(
      "permission denied",
    );
  });
  it("restricts Realtime topics to active participants", async () => {
    const room = await command("create", host, "Alex");
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ session_id: room.viewer.id, room_id: room.id }),
    ]);
    const allowed = await db.query<{ allowed: boolean }>(
      "select public.can_access_room_topic($1) allowed",
      [`room:${room.id}`],
    );
    expect(allowed.rows[0].allowed).toBe(true);
    const denied = await db.query<{ allowed: boolean }>(
      "select public.can_access_room_topic($1) allowed",
      ["room:some-other-room"],
    );
    expect(denied.rows[0].allowed).toBe(false);
    await command("leave");
    const revoked = await db.query<{ allowed: boolean }>(
      "select public.can_access_room_topic($1) allowed",
      [`room:${room.id}`],
    );
    expect(revoked.rows[0].allowed).toBe(false);
  });
  it("limits attempts persistently", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await db.query<{ ok: boolean }>(
        "select public.consume_rate_limit('test',2) ok",
      );
      expect(r.rows[0].ok).toBe(i < 2);
    }
  });
});
