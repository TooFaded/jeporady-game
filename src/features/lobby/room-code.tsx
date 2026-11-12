"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, ErrorMessage } from "@/components/ui";
export function RoomCode({ code, invite }: { code: string; invite: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <div
        className="room-code-display"
        aria-label={`Room code ${code.split("").join(" ")}`}
      >
        {code.split("").map((letter, index) => (
          <span key={index} aria-hidden="true">
            {letter}
          </span>
        ))}
      </div>
      <Button
        variant="secondary"
        className="full-width"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(invite);
            setCopied(true);
            setError(null);
          } catch {
            setError("Copy the invitation link below to share it.");
          }
        }}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
        {copied ? "Invitation copied" : "Copy invitation link"}
      </Button>
      <p role="status" className="sr-only">
        {copied ? "Invitation copied to clipboard" : ""}
      </p>
      <ErrorMessage message={error} />
    </>
  );
}
