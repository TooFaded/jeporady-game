import { EntryForm } from "@/features/lobby/entry-form";
import { roomCode } from "@/lib/validation";
import { notFound } from "next/navigation";
export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const parsed = roomCode.safeParse((await params).code);
  if (!parsed.success) notFound();
  return <EntryForm code={parsed.data} />;
}
