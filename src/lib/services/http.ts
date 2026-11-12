import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { database } from "@/lib/db/server";
import { hash } from "@/lib/utils/security";
const messages: Record<string, [number, string]> = {
  COMPETITION_NOT_CONFIGURED: [
    503,
    "Apply the Phase 3 database migration to enable competitive play.",
  ],
  PLAYER_ONLY: [403, "Only players can buzz. The host judges answers."],
  BUZZ_INELIGIBLE: [
    409,
    "You have already attempted this clue or need to reconnect.",
  ],
  BUZZ_CLOSED: [409, "Buzzers are closed or another player buzzed first."],
  NO_ELIGIBLE_PLAYERS: [
    409,
    "No connected players are eligible. Reveal the answer or wait for reconnection.",
  ],
  ALREADY_JUDGED: [409, "This attempt has already been judged."],
  ANSWER_EXPIRED: [
    409,
    "Time is up. Mark incorrect or void this attempt without a penalty.",
  ],
  ROUND_PLAYED: [
    409,
    "This clue has attempts. Reveal and complete it to preserve scoring.",
  ],
  GAME_NOT_CONFIGURED: [
    503,
    "Apply the Phase 2 database migration to enable game boards.",
  ],
  INVALID_BOARD: [
    400,
    "Complete all five categories and 25 questions and answers before saving or starting.",
  ],
  STALE_GAME: [
    409,
    "The game changed in another tab. Refresh the latest state and try again.",
  ],
  INVALID_TRANSITION: [
    409,
    "That action is not available in the current game phase.",
  ],
  CLUE_UNAVAILABLE: [409, "That clue is unavailable or no longer active."],
  VERSION_REQUIRED: [409, "Refresh the page to use the current game controls."],
  HTTPS_REQUIRED: [
    400,
    "Production sessions require HTTPS. For local phone testing, start the server with npm run dev:lan and use its LAN address.",
  ],
  NOT_CONFIGURED: [
    503,
    "The arena is not configured yet. Add the Supabase environment variables to get started.",
  ],
  NOT_FOUND: [404, "That room does not exist. Check the code and try again."],
  CLOSED: [409, "This room has closed or the game has already started."],
  FULL: [409, "This room is full. Ask the host to create another game."],
  DUPLICATE_NAME: [409, "That nickname is taken. Try another one."],
  UNAUTHORIZED: [
    401,
    "Join this room to continue. Your session may have expired.",
  ],
  HOST_ONLY: [403, "Only the host can control the game."],
  EMPTY_ROOM: [409, "Invite at least one connected player before starting."],
  RATE_LIMITED: [429, "A few too many attempts. Please try again in a minute."],
  BAD_ORIGIN: [403, "This request must come from QuizArena."],
  BAD_REQUEST: [400, "Please check your input and try again."],
  BUSY: [503, "The arena is busy. Please try again."],
};
export function failure(error: unknown) {
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: error.issues[0].message },
      { status: 400 },
    );
  const message = error instanceof Error ? error.message : "";
  const match = Object.entries(messages).find(
    ([key]) => message === key || message.includes(key),
  );
  const [status, detail] = match?.[1] ?? [
    500,
    "Something went wrong. Please try again.",
  ];
  if (!match)
    console.error(
      "Room request failed",
      error instanceof Error ? error.name : "UnknownError",
    );
  return NextResponse.json(
    { error: detail, code: match?.[0] ?? "INTERNAL_ERROR" },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  // Next.js normalizes loopback URLs internally; preserve the actual request host.
  const expectedOrigin = `${request.nextUrl.protocol}//${request.headers.get("host") ?? request.nextUrl.host}`;
  if (!origin || origin !== expectedOrigin) throw new Error("BAD_ORIGIN");
}
export async function limit(request: NextRequest, kind: "create" | "join") {
  // Vercel overwrites this header; never trust arbitrary forwarding headers off Vercel.
  const ip = process.env.VERCEL
    ? (request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown")
    : "local";
  const salt = process.env.RATE_LIMIT_SALT;
  if (!salt) throw new Error("NOT_CONFIGURED");
  const { data, error } = await database().rpc("consume_rate_limit", {
    p_key: hash(`${salt}:${kind}:${ip}`),
    p_limit: kind === "create" ? 5 : 20,
  });
  if (error) throw error;
  if (!data) throw new Error("RATE_LIMITED");
}
export async function body(request: NextRequest, maxLength = 1024) {
  const raw = await request.text();
  if (raw.length > maxLength) throw new Error("BAD_REQUEST");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("BAD_REQUEST");
  }
}

export function requireSessionTransport(request: NextRequest) {
  if (
    process.env.NODE_ENV === "production" &&
    request.nextUrl.protocol !== "https:"
  )
    throw new Error("HTTPS_REQUIRED");
}
