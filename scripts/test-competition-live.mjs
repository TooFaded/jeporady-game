// Uses genuinely independent PostgREST transactions, not a single WASM connection.
// Run only after applying all migrations to a dedicated Supabase test project.
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
if (process.env.ALLOW_DATABASE_TESTS !== "true")
  throw new Error(
    "Set ALLOW_DATABASE_TESTS=true for a dedicated test project. This creates and deletes only its own test room.",
  );
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const digest = () => createHash("sha256").update(randomBytes(32)).digest("hex");
const host = digest(),
  players = Array.from({ length: 8 }, digest);
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = Array.from(randomBytes(6), (b) => alphabet[b % 32]).join("");
let id;
async function room(action = "state", token = host, name = null) {
  const r = await db.rpc("room_command", {
    p_action: action,
    p_code: code,
    p_token_hash: token,
    p_name: name,
  });
  assert.ifError(r.error);
  return r.data;
}
async function game(action, clue = null) {
  const state = await room();
  const r = await db.rpc("game_command", {
    p_code: code,
    p_token_hash: host,
    p_action: action,
    p_expected_version: state.game.version,
    p_clue_id: clue,
  });
  assert.ifError(r.error);
  return r.data;
}
async function compete(action, state, token = host) {
  return db.rpc("competition_command", {
    p_code: code,
    p_token_hash: token,
    p_action: action,
    p_expected_version: state.game.version,
    p_clue_id: state.game.active_clue?.id ?? null,
    p_round_id: state.game.competition.round_id,
    p_attempt_id: state.game.competition.attempt?.id ?? null,
  });
}
try {
  const created = await room("create", host, "Competition Test Host");
  id = created.id;
  assert.ok(created.game?.competition, "Apply the Phase 3 migration first.");
  await Promise.all(
    players.map((token, i) => room("join", token, `Contender ${i + 1}`)),
  );
  await game("start");
  const tiles = (await room()).game.categories.flatMap((c) => c.clues);
  for (const tile of tiles.slice(0, 5)) {
    await Promise.all(players.map((token) => room("heartbeat", token)));
    await game("select", tile.id);
    const opened = await compete("open", await room());
    assert.ifError(opened.error);
    // Simultaneous network calls. PostgreSQL room locks arbitrate, not Promise order.
    const races = await Promise.all(
      players.map((token) => compete("buzz", opened.data, token)),
    );
    const accepted = races.filter((r) => !r.error);
    assert.equal(accepted.length, 1, "Exactly one winner per round");
    assert.ok(
      races
        .filter((r) => r.error)
        .every((r) => r.error.message.includes("BUZZ_CLOSED")),
    );
    const won = accepted[0].data;
    const retry = await compete("buzz", opened.data, players[0]);
    assert.ok(retry.error);
    // Same version and attempt ID: only one score change can commit.
    const judgments = await Promise.all(
      Array.from({ length: 4 }, () => compete("correct", won)),
    );
    assert.equal(judgments.filter((r) => !r.error).length, 1);
    assert.ok(
      judgments
        .filter((r) => r.error)
        .every((r) => r.error.message.includes("STALE_GAME")),
    );
    await game("complete", tile.id);
  }
  const final = await game("end");
  const leaderboard = final.game.competition.leaderboard;
  assert.equal(
    leaderboard.reduce((n, p) => n + p.correct, 0),
    5,
  );
  assert.equal(
    leaderboard.reduce((n, p) => n + p.score, 0),
    3000,
  );
  const attempts = await db
    .from("answer_attempts")
    .select("id,outcome,score_delta")
    .eq("room_id", id);
  assert.ifError(attempts.error);
  assert.equal(attempts.data.length, 5);
  assert.ok(attempts.data.every((a) => a.outcome === "correct"));
  console.log(
    "PASS: 5 rounds × 8 concurrent buzzes; one winner each; 4 concurrent judgments per round; exact score totals and final leaderboard.",
  );
} finally {
  if (id) {
    const cleanup = await db.from("game_rooms").delete().eq("id", id);
    assert.ifError(cleanup.error);
  }
}
