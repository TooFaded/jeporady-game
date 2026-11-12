import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  boardDraftSchema,
  gameRequestSchema,
} from "../src/lib/game-validation";
function board() {
  return {
    categories: Array.from({ length: 5 }, (_, position) => ({
      id: randomUUID(),
      position,
      name: `Category ${position}`,
      clues: Array.from({ length: 5 }, (_, position) => ({
        id: randomUUID(),
        position,
        question: "A question?",
        answer: "An answer",
      })),
    })),
  };
}
describe("board and game request validation", () => {
  it("accepts exactly 25 complete clues", () =>
    expect(boardDraftSchema.parse(board()).categories).toHaveLength(5));
  it("rejects missing clues and blank answers", () => {
    const draft = board();
    draft.categories[0].clues.pop();
    expect(boardDraftSchema.safeParse(draft).success).toBe(false);
    const blank = board();
    blank.categories[0].clues[0].answer = "\n\t ";
    expect(boardDraftSchema.safeParse(blank).success).toBe(false);
  });
  it("rejects duplicate IDs, positions and category names", () => {
    const draft = board();
    draft.categories[1].name = draft.categories[0].name.toUpperCase();
    draft.categories[0].clues[1].id = draft.categories[0].clues[0].id;
    draft.categories[0].clues[1].position = 0;
    expect(boardDraftSchema.safeParse(draft).success).toBe(false);
  });
  it("rejects oversized questions and extra client state", () => {
    const draft = board();
    draft.categories[0].clues[0].question = "x".repeat(1001);
    expect(boardDraftSchema.safeParse(draft).success).toBe(false);
    expect(
      gameRequestSchema.safeParse({
        action: "reveal",
        expectedVersion: 1,
        clueId: randomUUID(),
        phase: "completed",
      }).success,
    ).toBe(false);
  });
  it("requires a version on every mutation and active IDs on clue actions", () => {
    for (const action of [
      "start",
      "save",
      "select",
      "reveal",
      "complete",
      "return",
      "end",
    ])
      expect(gameRequestSchema.safeParse({ action }).success).toBe(false);
    for (const action of ["select", "reveal", "complete", "return"])
      expect(
        gameRequestSchema.safeParse({ action, expectedVersion: 0 }).success,
      ).toBe(false);
    expect(gameRequestSchema.safeParse({ action: "editor" }).success).toBe(
      true,
    );
  });
});
