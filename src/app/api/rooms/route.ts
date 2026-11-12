import { NextRequest, NextResponse } from "next/server";
import { nameInput } from "@/lib/validation";
import { cookieName, credential, hash } from "@/lib/utils/security";
import { createRoom } from "@/lib/services/rooms";
import {
  body,
  failure,
  limit,
  sameOrigin,
  requireSessionTransport,
} from "@/lib/services/http";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    requireSessionTransport(request);
    const { name } = nameInput.parse(await body(request));
    await limit(request, "create");
    const token = credential();
    const code = await createRoom(hash(token), name);
    const response = NextResponse.json({ code }, { status: 201 });
    response.cookies.set(cookieName(code), token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 86400,
    });
    return response;
  } catch (error) {
    return failure(error);
  }
}
