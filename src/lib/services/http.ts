import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { database } from "@/lib/db/server";
import { hash } from "@/lib/utils/security";
const messages: Record<string, [number, string]> = {
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
  HOST_ONLY: [403, "Only the host can start the game."],
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
    { error: detail },
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
export async function body(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > 1024) throw new Error("BAD_REQUEST");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("BAD_REQUEST");
  }
}
