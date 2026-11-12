import { describe, expect, it, vi } from "vitest";
import { generateCode, credential, hash } from "../src/lib/utils/security";
import { nameInput, roomCode } from "../src/lib/validation";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/db/server", () => ({ database: () => ({ rpc }) }));
import { createRoom } from "../src/lib/services/rooms";
describe("room inputs and credentials", () => {
  it("normalizes room codes and trims names", () => {
    expect(roomCode.parse(" abcd23 ")).toBe("ABCD23");
    expect(nameInput.parse({ name: " Alex " }).name).toBe("Alex");
  });
  it.each(["ABC", "ABC1234", "ABC10O", "<CODE>"])(
    "rejects malformed room code %s",
    (value) => {
      expect(roomCode.safeParse(value).success).toBe(false);
    },
  );
  it.each(["a", "a".repeat(25), "<script>", "  ", "a\nb"])(
    "rejects invalid nickname %s",
    (name) => {
      expect(nameInput.safeParse({ name }).success).toBe(false);
    },
  );
  it("accepts international nicknames", () => {
    expect(nameInput.safeParse({ name: "Élodie 王" }).success).toBe(true);
  });
  it("generates six-character unambiguous codes and independent secrets", () => {
    for (let i = 0; i < 100; i++)
      expect(roomCode.safeParse(generateCode()).success).toBe(true);
    const token = credential();
    expect(token.length).toBe(43);
    expect(credential()).not.toBe(token);
    expect(hash(token)).toHaveLength(64);
    expect(hash(token)).not.toContain(token);
  });
  it("retries database-enforced room collisions", async () => {
    rpc.mockReset();
    rpc
      .mockResolvedValueOnce({ error: { message: "CODE_TAKEN" } })
      .mockResolvedValueOnce({ data: {}, error: null });
    const codes = vi
      .fn()
      .mockReturnValueOnce("ABCDEF")
      .mockReturnValueOnce("GHJKLM");
    expect(await createRoom(hash("secret"), "Alex", codes)).toBe("GHJKLM");
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("bounds retries", async () => {
    rpc.mockReset();
    rpc.mockResolvedValue({ error: { message: "CODE_TAKEN" } });
    await expect(createRoom(hash("secret"), "Alex")).rejects.toThrow("BUSY");
    expect(rpc).toHaveBeenCalledTimes(8);
  });
  it("does not retry unrelated failures", async () => {
    rpc.mockReset();
    rpc.mockResolvedValue({ error: { message: "DB_UNAVAILABLE" } });
    await expect(createRoom(hash("secret"), "Alex")).rejects.toThrow(
      "DB_UNAVAILABLE",
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
