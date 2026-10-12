"use client";

import { useState, useTransition } from "react";
import { Check, CircleCheck, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { Button } from "@/components/admin/Button";
import { Dialog } from "@/components/admin/Dialog";
import { Field, Textarea } from "@/components/admin/Field";
import { useToast } from "@/components/admin/Toast";
import { acknowledgeException, resolveException, resyncShipment, type ExceptionActionResult } from "./actions";

/**
 * Actions for one delivery exception.
 *   layout="row"    list row / phone card: Resync + ⋮ (Acknowledge, Resolve…, Open order, Copy AWB)
 *   layout="inline" order tracking panel: Acknowledge + Resolve… buttons (the panel has its own Resync)
 * Buttons are hidden without the permission; the server actions re-check it.
 */
export function ExceptionActions({
  id,
  orderId,
  trackingId,
  status,
  awb,
  canResync,
  canManage,
  layout = "row",
}: {
  id: string;
  orderId: string;
  trackingId: string | null;
  status: string;
  awb: string | null;
  canResync: boolean;
  canManage: boolean;
  layout?: "row" | "inline";
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"resync" | "ack" | null>(null);
  const [resolving, setResolving] = useState(false);
  const canAck = canManage && status === "OPEN";
  const canResolve = canManage && status !== "RESOLVED";

  function run(kind: "resync" | "ack", fn: () => Promise<ExceptionActionResult>, okTitle: string) {
    setBusy(kind);
    startTransition(async () => {
      const r = await fn();
      setBusy(null);
      if (r.ok) toast({ title: okTitle, description: r.message, tone: "success" });
      else toast({ title: "Couldn't complete that", description: r.error, tone: "error" });
    });
  }

  const resync = () => run("resync", () => resyncShipment({ orderId, trackingId }), "Tracking checked");
  const acknowledge = () => run("ack", () => acknowledgeException(id), "Acknowledged");

  const dialog = (
    <Dialog
      open={resolving}
      onClose={() => setResolving(false)}
      title="Resolve exception"
      description={
        <>
          Order <span className="font-mono">{orderId}</span>. The note is kept with the exception history.
        </>
      }
      size="sm"
    >
      <ResolveForm
        onCancel={() => setResolving(false)}
        onSubmit={async (note) => {
          const r = await resolveException(id, note);
          if (r.ok) {
            setResolving(false);
            toast({ title: "Resolved", description: r.message, tone: "success" });
          }
          return r;
        }}
      />
    </Dialog>
  );

  if (layout === "inline") {
    if (!canAck && !canResolve) return null;
    return (
      <div className="flex shrink-0 items-center gap-2">
        {canAck && (
          <Button size="sm" variant="ghost" onClick={acknowledge} loading={pending && busy === "ack"} disabled={pending}>
            Acknowledge
          </Button>
        )}
        {canResolve && (
          <Button size="sm" variant="secondary" onClick={() => setResolving(true)} disabled={pending}>
            Resolve
          </Button>
        )}
        {dialog}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {canResync && (
        <Button
          size="sm"
          variant="secondary"
          onClick={resync}
          loading={pending && busy === "resync"}
          disabled={pending}
          icon={<RefreshCw size={14} aria-hidden />}
        >
          Resync
        </Button>
      )}
      <ActionMenu
        title={`Exception on ${orderId}`}
        items={[
          { label: "Acknowledge", icon: <Check size={15} aria-hidden />, onSelect: acknowledge, hidden: !canAck, disabled: pending },
          {
            label: "Resolve…",
            icon: <CircleCheck size={15} aria-hidden />,
            onSelect: () => setResolving(true),
            hidden: !canResolve,
            disabled: pending,
          },
          { label: "Open order", icon: <ExternalLink size={15} aria-hidden />, href: `/admin/orders/${orderId}` },
          { label: "Copy AWB", icon: <Copy size={15} aria-hidden />, copy: awb ?? undefined, hidden: !awb },
        ]}
      />
      {dialog}
    </div>
  );
}

// Mounted only while the dialog is open, so the note resets every time.
function ResolveForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (note: string) => Promise<ExceptionActionResult>;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ok = note.trim().length >= 3;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok || pending) return;
        setError(null);
        startTransition(async () => {
          const r = await onSubmit(note.trim());
          if (!r.ok) setError(r.error);
        });
      }}
    >
      <Field
        label="Resolution note"
        htmlFor="exception-resolution"
        error={error}
        hint="What happened and what was done, e.g. “Courier confirmed delivery on 9 Oct; customer informed.”"
      >
        <Textarea
          id="exception-resolution"
          data-autofocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          required
          invalid={!!error}
        />
      </Field>
      <div className="-mx-4 -mb-4 mt-5 flex justify-end gap-2 border-t border-admin-line px-4 py-3 sm:-mx-5 sm:px-5">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!ok} loading={pending}>
          Resolve
        </Button>
      </div>
    </form>
  );
}
