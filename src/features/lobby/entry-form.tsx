"use client";
import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Crown, Users } from "lucide-react";
import { Button, Card, ErrorMessage, Input } from "@/components/ui";
import { nameInput } from "@/lib/validation";
import { api } from "./api";
import { verifyRoomSession } from "./enter-room";
const subscribeHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
export function EntryForm({ code }: { code?: string }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    clientReady,
    serverReady,
  );
  const [joinedCode, setJoinedCode] = useState<string | null>(null);
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
              // If verification fails, retry it without creating another player/room.
              const result = joinedCode
                ? { code: joinedCode }
                : await api<{ code: string }>(
                    code ? `/api/rooms/${code}/join` : "/api/rooms",
                    parsed.data,
                  );
              setJoinedCode(result.code);
              await verifyRoomSession(result.code);
              router.replace(`/room/${result.code}`);
            } catch (error) {
              setError(
                error instanceof Error ? error.message : "Please try again.",
              );
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={!hydrated || busy}>
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
              {!hydrated
                ? "Loading secure form…"
                : joinedCode
                  ? "Continue to lobby"
                  : code
                    ? "Join the lobby"
                    : "Create game room"}
              <ArrowRight size={18} />
            </Button>
          </fieldset>
          <noscript>JavaScript must be enabled to join a live room.</noscript>
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
