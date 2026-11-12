"use client";
import { useEffect, useRef } from "react";
import { Button } from ".";
export function ConfirmDialog({
  open,
  title,
  description,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby="dialog-title"
      aria-describedby="dialog-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="dialog-title">{title}</h2>
      <p id="dialog-description">{description}</p>
      <div className="dialog-actions">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Stay here
        </Button>
        <Button onClick={onConfirm} busy={busy}>
          Leave room
        </Button>
      </div>
    </dialog>
  );
}
