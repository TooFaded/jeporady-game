import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { hash } from "../src/lib/utils/security";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../src/lib/db/server", () => ({
  database: () => ({ rpc: mocks.rpc }),
}));
import { POST } from "../src/app/api/rooms/[code]/game/route";
function request(
  body: object,
  cookie = true,
  origin = "http://localhost:3000",
) {
  return new NextRequest("http://localhost:3000/api/rooms/ABCDEF/game", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...(cookie
        ? { cookie: "qa_session_ABCDEF=private-test-credential" }
        : {}),
    },
    body: JSON.stringify(body),
  });
}
const context = () => ({ params: Promise.resolve({ code: "ABCDEF" }) });
const buzz = () => ({
  action: "buzz",
  clueId: randomUUID(),
  roundId: randomUUID(),
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({
    data: { game: { phase: "player_answering" } },
    error: null,
  });
});
describe("competitive HTTP boundary", () => {
  it("hashes the authenticated credential and passes only round/clue identifiers", async () => {
    const input = buzz();
    const response = await POST(request(input), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("competition_command", {
      p_code: "ABCDEF",
      p_token_hash: hash("private-test-credential"),
      p_action: "buzz",
      p_expected_version: null,
      p_clue_id: input.clueId,
      p_round_id: input.roundId,
      p_attempt_id: null,
      p_mode: null,
      p_seconds: null,
    });
  });
  it.each(["playerId", "score", "timestamp", "deadline"])(
    "rejects forged %s instead of trusting client data",
    async (field) => {
      const response = await POST(
        request({ ...buzz(), [field]: "forged" }),
        context(),
      );
      expect(response.status).toBe(400);
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it("rejects missing sessions and cross-origin submissions before RPC", async () => {
    expect((await POST(request(buzz(), false), context())).status).toBe(401);
    expect(
      (await POST(request(buzz(), true, "https://attacker.example"), context()))
        .status,
    ).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["HOST_ONLY", 403],
    ["BUZZ_CLOSED", 409],
    ["ANSWER_EXPIRED", 409],
    ["UNAUTHORIZED", 401],
  ])("preserves %s status", async (message, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } });
    expect((await POST(request(buzz()), context())).status).toBe(status);
  });
  it("requires an exact attempt ID and version to judge", async () => {
    const response = await POST(
      request({ action: "correct", clueId: randomUUID(), expectedVersion: 2 }),
      context(),
    );
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("bounds persisted scoring settings", async () => {
    for (const seconds of [0, 61, 10.5])
      expect(
        (
          await POST(
            request({
              action: "configure",
              expectedVersion: 0,
              mode: "classic",
              seconds,
            }),
            context(),
          )
        ).status,
      ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("dispatches team choice with authenticated identity and rejects choosing for someone else", async () => {
    const teamId = randomUUID();
    const result = await POST(
      request({ action: "choose_team", expectedVersion: 1, teamId }),
      context(),
    );
    expect(result.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "team_command",
      expect.objectContaining({
        p_token_hash: hash("private-test-credential"),
        p_action: "choose_team",
        p_data: { expectedVersion: 1, teamId },
      }),
    );
    mocks.rpc.mockClear();
    expect(
      (
        await POST(
          request({
            action: "choose_team",
            expectedVersion: 1,
            teamId,
            playerId: randomUUID(),
          }),
          context(),
        )
      ).status,
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not use a session cookie belonging to another room", async () => {
    const req = new NextRequest("http://localhost:3000/api/rooms/ABCDEF/game", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        cookie: "qa_session_GHJKLM=other-room-session",
      },
      body: JSON.stringify(buzz()),
    });
    expect((await POST(req, context())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects invented team scores and oversized capacities", async () => {
    for (const input of [
      {
        action: "team_setup",
        expectedVersion: 1,
        mode: "team",
        count: 2,
        capacity: 17,
      },
      {
        action: "team_edit",
        expectedVersion: 1,
        teamId: randomUUID(),
        name: "Blue",
        color: "blue",
        score: 999,
      },
    ])
      expect((await POST(request(input), context())).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
