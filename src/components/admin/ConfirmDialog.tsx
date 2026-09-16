"use client";

import { useState, type ReactNode } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { Input } from "./Field";

/**
 * Confirmation for consequential actions. With `requireText` the confirm button
 * stays disabled until the operator types that exact text (e.g. the product
 * name) — the guard for permanent deletes.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "danger",
  requireText,
  busy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "default";
  requireText?: string;
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={busy ? () => {} : onClose} title={title} description={description} size="sm">
      <ConfirmBody
        onClose={onClose}
        onConfirm={onConfirm}
        confirmLabel={confirmLabel}
        tone={tone}
        requireText={requireText}
        busy={busy}
      >
        {children}
      </ConfirmBody>
    </Dialog>
  );
}

// Mounted only while the dialog is open, so the typed text resets every time.
function ConfirmBody({
  onClose,
  onConfirm,
  confirmLabel,
  tone,
  requireText,
  busy,
  children,
}: {
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  tone: "danger" | "default";
  requireText?: string;
  busy?: boolean;
  children?: ReactNode;
}) {
  const [typed, setTyped] = useState("");
  const ok = !requireText || typed.trim() === requireText;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ok && !busy) onConfirm();
      }}
    >
      {children}
      {requireText && (
        <label className="mt-1 block space-y-1.5">
          <span className="block text-[13px] text-brand-ink-soft">
            Type <b className="font-semibold text-brand-ink">{requireText}</b> to confirm.
          </span>
          <Input data-autofocus value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
      )}
      <div className="-mx-4 -mb-4 mt-5 flex justify-end gap-2 border-t border-admin-line px-4 py-3 sm:-mx-5 sm:px-5">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant={tone === "danger" ? "danger" : "primary"} disabled={!ok} loading={busy}>
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}
