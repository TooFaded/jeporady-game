"use client";
import { useEffect, useRef, useId } from "react";
import { Button } from ".";
export function ConfirmDialog({
  open,
  title,
  description,
  busy,
  onCancel,
  onConfirm,
  confirmLabel = "Leave room",
  cancelLabel = "Stay here",
}: {
  open: boolean;
  title: string;
  description: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id={`${id}-title`}>{title}</h2>
      <p id={`${id}-description`}>{description}</p>
      <div className="dialog-actions">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button onClick={onConfirm} busy={busy}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
