import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
if (process.env.ALLOW_DATABASE_TESTS !== "true")
  throw new Error(
    "Use a dedicated test project and set ALLOW_DATABASE_TESTS=true in .env.local. This test creates and deletes test rooms.",
  );
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } },
);
const digest = () => createHash("sha256").update(randomBytes(32)).digest("hex");
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = Array.from(randomBytes(6), (b) => alphabet[b % 32]).join("");
const host = digest();
let id;
const rpc = (action, token, name = null) =>
  db.rpc("room_command", {
    p_action: action,
    p_code: code,
    p_token_hash: token,
    p_name: name,
  });
try {
  const created = await rpc("create", host, "Test Host");
  assert.ifError(created.error);
  id = created.data.id;
  const collision = await rpc("create", digest(), "Other Host");
  assert.match(collision.error?.message ?? "", /CODE_TAKEN/);
  const joins = await Promise.all(
    Array.from({ length: 2 }, () => rpc("join", digest(), "Same Name")),
  );
  assert.equal(joins.filter((r) => !r.error).length, 1);
  assert.equal(
    joins.filter((r) => r.error?.message.includes("DUPLICATE_NAME")).length,
    1,
  );
  const extra = await Promise.all(
    Array.from({ length: 20 }, (_, i) => rpc("join", digest(), `Player ${i}`)),
  );
  assert.equal(extra.filter((r) => !r.error).length, 15);
  assert.equal(
    extra.filter((r) => r.error?.message.includes("FULL")).length,
    5,
  );
  const starts = await Promise.all([rpc("start", host), rpc("start", host)]);
  assert.equal(starts.filter((r) => !r.error).length, 1);
  const forbidden = await anon.rpc("room_command", {
    p_action: "state",
    p_code: code,
    p_token_hash: host,
    p_name: null,
  });
  assert.ok(forbidden.error);
  const rows = await anon.from("room_credentials").select("*");
  assert.ok(rows.error);
  console.log(
    "PASS: live create, collision, concurrent duplicate joins, capacity, single-start transition, and anonymous access denial.",
  );
} finally {
  if (id) {
    const cleanup = await db.from("game_rooms").delete().eq("id", id);
    assert.ifError(cleanup.error);
  }
}
