import { z } from "zod";
const version = z.number().int().min(0).max(2147483646);
const position = z.number().int().min(0).max(4);
const clue = z
  .object({
    id: z.uuid(),
    position,
    question: z
      .string()
      .trim()
      .min(1, "Every clue needs a question.")
      .max(1000),
    answer: z.string().trim().min(1, "Every clue needs an answer.").max(300),
  })
  .strict();
const category = z
  .object({
    id: z.uuid(),
    position,
    name: z.string().trim().min(1, "Every category needs a name.").max(40),
    clues: z.array(clue).length(5),
  })
  .strict();
export const boardDraftSchema = z
  .object({ categories: z.array(category).length(5) })
  .strict()
  .superRefine((board, context) => {
    const categories = board.categories;
    const unique = (values: unknown[]) =>
      new Set(values).size === values.length;
    if (
      !unique(categories.map((c) => c.id)) ||
      !unique(categories.map((c) => c.position)) ||
      !unique(categories.map((c) => c.name.toLowerCase()))
    )
      context.addIssue({
        code: "custom",
        message: "Use five distinct categories with unique positions.",
        path: ["categories"],
      });
    const clues = categories.flatMap((c) => c.clues);
    if (
      !unique(clues.map((c) => c.id)) ||
      categories.some((c) => !unique(c.clues.map((q) => q.position)))
    )
      context.addIssue({
        code: "custom",
        message:
          "Each of the 25 clues must have a unique ID and a unique position in its category.",
        path: ["categories"],
      });
  });
const active = { expectedVersion: version, clueId: z.uuid() };
export const gameRequestSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("buzz"), clueId: z.uuid(), roundId: z.uuid() })
    .strict(),
  z
    .object({
      action: z.literal("configure"),
      expectedVersion: version,
      mode: z.enum(["classic", "casual"]),
      seconds: z.number().int().min(3).max(60),
    })
    .strict(),
  ...(["open", "close"] as const).map((action) =>
    z.object({ action: z.literal(action), ...active }).strict(),
  ),
  ...(["correct", "incorrect", "void"] as const).map((action) =>
    z
      .object({ action: z.literal(action), ...active, attemptId: z.uuid() })
      .strict(),
  ),
  z.object({ action: z.literal("editor") }).strict(),
  z
    .object({
      action: z.literal("save"),
      expectedVersion: version,
      board: boardDraftSchema,
    })
    .strict(),
  z.object({ action: z.literal("start"), expectedVersion: version }).strict(),
  z.object({ action: z.literal("select"), ...active }).strict(),
  z.object({ action: z.literal("reveal"), ...active }).strict(),
  z.object({ action: z.literal("complete"), ...active }).strict(),
  z.object({ action: z.literal("return"), ...active }).strict(),
  z.object({ action: z.literal("end"), expectedVersion: version }).strict(),
]);
export type GameRequest = z.infer<typeof gameRequestSchema>;
