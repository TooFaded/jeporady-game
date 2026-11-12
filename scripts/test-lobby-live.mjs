// Tests only rooms created by this run. Never prints cookies, JWTs, or API keys.
import assert from "node:assert/strict";
import { networkInterfaces } from "node:os";
import { createClient } from "@supabase/supabase-js";
const lan = (networkInterfaces().en0 ?? []).find(
  (entry) => entry.family === "IPv4" && !entry.internal,
)?.address;
const origin =
  process.env.TEST_LAN === "true"
    ? `http://${lan}:3000`
    : process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
let code;
function browser() {
  let cookie = "";
  return {
    async post(path, data = {}) {
      const response = await fetch(`${origin}${path}`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(15000),
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      const body = await response.json();
      return { status: response.status, ...body };
    },
  };
}
const host = browser(),
  player = browser(),
  outsider = browser();
let live;
let playerLive;
try {
  const created = await host.post("/api/rooms", {
    name: "Lobby regression host",
  });
  assert.equal(created.status, 201, created.error);
  code = created.code;
  const hostState = await host.post(`/api/rooms/${code}/state`);
  assert.equal(hostState.status, 200);
  assert.equal(hostState.room.viewer.role, "host");
  const denied = await outsider.post(`/api/rooms/${code}/state`);
  assert.equal(denied.status, 401);
  const getToken = async () => {
    const response = await host.post(`/api/rooms/${code}/token`);
    assert.equal(response.status, 200, response.error);
    return response.token;
  };
  live = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { accessToken: getToken },
  );
  await live.realtime.setAuth();
  let channel = live.channel(`room:${hostState.room.id}`, {
    config: { private: true },
  });
  let events = 0;
  channel.on("broadcast", { event: "room_changed" }, () => {
    events++;
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Private Realtime subscription timed out")),
      15000,
    );
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        reject(new Error(`Private Realtime subscription failed: ${status}`));
      }
    });
  });
  const joined = await player.post(`/api/rooms/${code}/join`, {
    name: "Lobby regression player",
  });
  assert.equal(joined.status, 201, joined.error);
  const playerState = await player.post(`/api/rooms/${code}/state`);
  assert.equal(playerState.status, 200);
  assert.equal(playerState.room.viewer.role, "player");
  const playerId = playerState.room.viewer.player_id;
  for (let i = 0; i < 30 && events < 1; i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(events >= 1, "host receives join broadcast");

  playerLive = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      accessToken: async () => {
        const result = await player.post(`/api/rooms/${code}/token`);
        assert.equal(result.status, 200);
        return result.token;
      },
    },
  );
  await playerLive.realtime.setAuth();
  let playerEvents = 0;
  const playerChannel = playerLive.channel(`room:${hostState.room.id}`, {
    config: { private: true },
  });
  playerChannel.on("broadcast", { event: "room_changed" }, () => {
    playerEvents++;
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Player subscription timed out")),
      15000,
    );
    playerChannel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        reject(new Error("Player subscription failed"));
      }
    });
  });
  const hostBeforeThird = events;
  const third = await outsider.post(`/api/rooms/${code}/join`, {
    name: "Third regression player",
  });
  assert.equal(third.status, 201);
  for (
    let i = 0;
    i < 30 && (events === hostBeforeThird || playerEvents === 0);
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(
    events > hostBeforeThird && playerEvents > 0,
    "both host and player receive the third player join",
  );
  assert.equal(
    (await host.post(`/api/rooms/${code}/state`)).room.players.length,
    2,
  );
  assert.equal(
    (await player.post(`/api/rooms/${code}/state`)).room.players.length,
    2,
  );
  assert.equal((await outsider.post(`/api/rooms/${code}/leave`)).status, 200);
  const updated = await host.post(`/api/rooms/${code}/heartbeat`);
  assert.equal(updated.room.players.length, 1);
  assert.equal(updated.room.viewer.role, "host");
  const resumed = await player.post(`/api/rooms/${code}/join`, {
    name: "Ignored on resume",
  });
  assert.equal(resumed.status, 200);
  const refreshed = await player.post(`/api/rooms/${code}/heartbeat`);
  assert.equal(refreshed.room.players.length, 1);
  assert.equal(refreshed.room.viewer.player_id, playerId);
  assert.equal((await player.post(`/api/rooms/${code}/start`)).status, 403);
  // Exercise a socket reconnect and the custom callback auth path.
  await live.removeChannel(channel);
  await live.realtime.setAuth();
  channel = live.channel(`room:${hostState.room.id}`, {
    config: { private: true },
  });
  channel.on("broadcast", { event: "room_changed" }, () => {
    events++;
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Recreated private channel timed out")),
      15000,
    );
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        reject(new Error("Recreated private channel failed"));
      }
    });
  });
  // Let the SDK heartbeat invoke its accessToken callback before the next event.
  console.log(
    "PASS: sessions, private join broadcast, roster and channel recreation; checking heartbeat token refresh…",
  );
  await new Promise((resolve) => setTimeout(resolve, 35000));
  await playerLive.removeAllChannels();
  const beforeLeave = events;
  assert.equal((await player.post(`/api/rooms/${code}/leave`)).status, 200);
  for (let i = 0; i < 30 && events === beforeLeave; i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(events > beforeLeave, "host receives leave broadcast");
  assert.equal(
    (await host.post(`/api/rooms/${code}/state`)).room.players.length,
    0,
  );
  assert.equal((await player.post(`/api/rooms/${code}/heartbeat`)).status, 401);
  console.log(
    "PASS: three independent cookie jars, host AND player private broadcasts, consistent rosters, resume without duplicates, socket reconnect, role isolation, revoked session.",
  );
} finally {
  if (playerLive) await playerLive.removeAllChannels();
  if (live) await live.removeAllChannels();
  if (code) {
    const result = await host.post(`/api/rooms/${code}/leave`);
    assert.equal(result.status, 200, "test room cleanup");
  }
}
