"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { roomCode } from "@/lib/validation";
import { ErrorMessage } from "@/components/ui";
export function JoinCode() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <form
      className="join-code"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = roomCode.safeParse(code);
        if (!parsed.success) setError(parsed.error.issues[0].message);
        else router.push(`/join/${parsed.data}`);
      }}
    >
      <label htmlFor="room-code">GOT AN INVITE? YOU’RE IN.</label>
      <div className="code-entry">
        <input
          id="room-code"
          aria-describedby={error ? "code-error" : undefined}
          placeholder="ROOM CODE"
          value={code}
          onChange={(event) => {
            setCode(event.target.value.toUpperCase());
            setError(null);
          }}
          maxLength={6}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <button type="submit">
          Join a Game <ArrowRight size={17} />
        </button>
      </div>
      <div id="code-error">
        <ErrorMessage message={error} />
      </div>
    </form>
  );
}
