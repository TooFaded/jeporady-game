import { NextRequest, NextResponse } from "next/server";
import { gameRequestSchema } from "@/lib/game-validation";
import { roomCode } from "@/lib/validation";
import { cookieName, hash } from "@/lib/utils/security";
import { gameCommand } from "@/lib/services/game";
import { body, failure, sameOrigin } from "@/lib/services/http";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  try {
    sameOrigin(request);
    const code = roomCode.parse((await context.params).code);
    const credential = request.cookies.get(cookieName(code))?.value;
    if (!credential) throw new Error("UNAUTHORIZED");
    const input = gameRequestSchema.parse(await body(request, 65536));
    const data = await gameCommand(code, hash(credential), input);
    return NextResponse.json(
      input.action === "editor" ? { editor: data } : { room: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
