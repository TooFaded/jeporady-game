"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Crown, Users } from "lucide-react";
import { Button, Card, ErrorMessage, Input } from "@/components/ui";
import { nameInput } from "@/lib/validation";
import { api } from "./api";
export function EntryForm({ code }: { code?: string }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <main id="main" className="entry-page">
      <Link href="/" className="back-link">
        <ArrowLeft size={16} /> Back to the arena
      </Link>
      <Card className="entry-card">
        <span className="large-icon">{code ? <Users /> : <Crown />}</span>
        <span className="eyebrow">
          {code ? `YOUR INVITE · ${code}` : "THE BEST NIGHTS START WITH YOU"}
        </span>
        <h1>{code ? "Your crew is waiting." : "Take the host’s seat."}</h1>
        <p>
          {code
            ? "Pick a nickname. Make yourself known in the arena."
            : "A name, a room, and your favorite people. Let’s get everyone together."}
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            const parsed = nameInput.safeParse({ name });
            if (!parsed.success) {
              setError(parsed.error.issues[0].message);
              return;
            }
            setBusy(true);
            try {
              const result = await api<{ code: string }>(
                code ? `/api/rooms/${code}/join` : "/api/rooms",
                parsed.data,
              );
              router.push(`/room/${result.code}`);
            } catch (error) {
              setError(
                error instanceof Error ? error.message : "Please try again.",
              );
              setBusy(false);
            }
          }}
        >
          <Input
            label={code ? "Your nickname" : "Your display name"}
            id="display-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={code ? "e.g. The Quiz Kid" : "e.g. Alex"}
            minLength={2}
            maxLength={24}
            required
            autoComplete="nickname"
            autoFocus
            aria-describedby="name-hint"
          />
          <p id="name-hint" className="input-hint">
            2–24 characters. This is how your crew will see you.
          </p>
          <ErrorMessage message={error} />
          <Button busy={busy} type="submit" className="full-width">
            {code ? "Join the lobby" : "Create game room"}
            <ArrowRight size={18} />
          </Button>
        </form>
        <div className="entry-footnote">
          {code
            ? "No account. No download. You’re invited."
            : "Up to 16 players · Private room · No account needed"}
        </div>
      </Card>
    </main>
  );
}
