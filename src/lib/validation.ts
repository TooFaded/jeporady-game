import { z } from "zod";
export const roomCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{6}$/, "Enter a valid six-character room code.");
export const nickname = z
  .string()
  .trim()
  .min(2, "Use at least 2 characters.")
  .max(24, "Use 24 characters or fewer.")
  .regex(
    /^[\p{L}\p{N} _.'-]+$/u,
    "Use letters, numbers, spaces, or simple punctuation.",
  );
export const nameInput = z.object({ name: nickname }).strict();
export const actionInput = z.enum([
  "state",
  "heartbeat",
  "start",
  "leave",
  "token",
  "join",
]);
