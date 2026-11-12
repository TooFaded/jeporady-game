import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { actionInput, nameInput, roomCode } from "@/lib/validation";
import { cookieName, credential, hash } from "@/lib/utils/security";
import { gameRequestSchema } from "@/lib/game-validation";
import { gameCommand } from "@/lib/services/game";
import { command } from "@/lib/services/rooms";
import {
  body,
  failure,
  limit,
  sameOrigin,
  requireSessionTransport,
} from "@/lib/services/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ code: string; action: string }> };
export async function POST(request: NextRequest, context: Context) {
  try {
    sameOrigin(request);
    const params = await context.params;
    const code = roomCode.parse(params.code);
    const action = actionInput.parse(params.action);
    const existing = request.cookies.get(cookieName(code))?.value;
    if (action === "join") {
      requireSessionTransport(request);
      const { name } = nameInput.parse(await body(request));
      await limit(request, "join");
      if (existing) {
        try {
          await command("state", code, hash(existing));
          return NextResponse.json({ code });
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !error.message.includes("UNAUTHORIZED")
          )
            throw error;
        }
      }
      const token = credential();
      await command("join", code, hash(token), name);
      const response = NextResponse.json({ code }, { status: 201 });
      response.cookies.set(cookieName(code), token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 86400,
      });
      return response;
    }
    if (!existing) throw new Error("UNAUTHORIZED");
    if (action === "start") {
      const current = await command("state", code, hash(existing));
      if (current?.viewer.role !== "host") throw new Error("HOST_ONLY");
      const input = gameRequestSchema.parse({
        ...(await body(request)),
        action: "start",
      });
      return NextResponse.json(
        { room: await gameCommand(code, hash(existing), input) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const state = await command(
      action === "token" ? "state" : action,
      code,
      hash(existing),
    );
    if (action === "token" && state) {
      const token = await new SignJWT({
        role: "authenticated",
        room_id: state.id,
        session_id: state.viewer.id,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(state.viewer.id)
        .setAudience("authenticated")
        .setIssuedAt()
        .setExpirationTime("60s")
        .sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!));
      return NextResponse.json(
        { token },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const response = NextResponse.json(
      { room: state },
      { headers: { "Cache-Control": "no-store" } },
    );
    if (action === "leave") response.cookies.delete(cookieName(code));
    return response;
  } catch (error) {
    return failure(error);
  }
}
