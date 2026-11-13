import { configuredOrigin } from "@/lib/public-origin";
import { Lobby } from "@/features/lobby/lobby";
import { roomCode } from "@/lib/validation";
import { notFound } from "next/navigation";
export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const parsed = roomCode.safeParse((await params).code);
  if (!parsed.success) notFound();
  return <Lobby code={parsed.data} publicOrigin={configuredOrigin()} />;
}
