"use client";

import { useState, useTransition } from "react";
import { Boxes, CircleCheck } from "lucide-react";
import { Button } from "@/components/admin/Button";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { Dialog } from "@/components/admin/Dialog";
import { Field, Input, Textarea } from "@/components/admin/Field";
import { useToast } from "@/components/admin/Toast";
import {
  checkStockAction,
  completeClaimAction,
  decideClaimAction,
  recordShipmentAction,
  returnReceivedAction,
  type DeskResult,
} from "./actions";

type Decision = "APPROVE" | "REJECT" | "NEEDS_INFO" | "UNDER_REVIEW";

const DECISION_COPY: Record<Decision, { title: string; label: string; hint: string; required: boolean }> = {
  APPROVE: { title: "Approve claim", label: "Note to the customer", hint: "Optional — added to the approval message.", required: false },
  REJECT: { title: "Reject claim", label: "Reason for the customer", hint: "Required — explain the decision plainly.", required: true },
  NEEDS_INFO: { title: "Ask for more information", label: "What do you need?", hint: "Required — e.g. a photo of the battery compartment.", required: true },
  UNDER_REVIEW: { title: "Mark under review", label: "Internal note", hint: "Optional.", required: false },
};

/**
 * Claim actions by status. Decide (claims.decide): approve / need info /
 * reject / under review. Fulfil (claims.fulfil): record shipment or return
 * pickup, mark the return received, complete. "Check stock now" is a read.
 */
export function ClaimActions({
  claimId,
  status,
  type,
  canDecide,
  canFulfil,
}: {
  claimId: string;
  status: string;
  type: string;
  canDecide: boolean;
  canFulfil: boolean;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [dialog, setDialog] = useState<"ship" | "received" | "complete" | null>(null);
  const [stock, setStock] = useState<string | null>(null);
  const replacement = type === "REPLACEMENT";
  const deciding = ["SUBMITTED", "UNDER_REVIEW", "NEEDS_INFO"].includes(status);

  function report(r: DeskResult, okTitle: string) {
    if (r.ok) toast({ title: okTitle, description: r.message, tone: "success" });
    else toast({ title: "Couldn't complete that", description: r.error, tone: "error" });
  }

  const showStockCheck = replacement && ["SUBMITTED", "UNDER_REVIEW", "NEEDS_INFO", "APPROVED"].includes(status);
  const any =
    showStockCheck ||
    (canDecide && deciding) ||
    (canFulfil && ["APPROVED", "RETURN_IN_TRANSIT", "REPLACEMENT_SHIPPED", "RECEIVED"].includes(status));
  if (!any) return null;

  return (
    <div className="space-y-3 border-t border-admin-line px-4 py-3 sm:px-5">
      {showStockCheck && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={<Boxes size={14} aria-hidden />}
            loading={pending && stock === "…"}
            disabled={pending}
            onClick={() => {
              setStock("…");
              startTransition(async () => {
                const r = await checkStockAction(claimId);
                setStock(r.ok ? (r.message ?? "") : r.error);
              });
            }}
          >
            Check stock now
          </Button>
          {stock && stock !== "…" && <span className="text-xs text-brand-ink-soft">{stock}</span>}
        </div>
      )}

      {canDecide && deciding && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" icon={<CircleCheck size={14} aria-hidden />} onClick={() => setDecision("APPROVE")} disabled={pending}>
            Approve {replacement ? "replacement" : "return"}
          </Button>
          <Button size="sm" onClick={() => setDecision("NEEDS_INFO")} disabled={pending}>
            Need info
          </Button>
          <Button size="sm" onClick={() => setDecision("REJECT")} disabled={pending}>
            Reject
          </Button>
          {status !== "UNDER_REVIEW" && (
            <Button size="sm" variant="ghost" onClick={() => setDecision("UNDER_REVIEW")} disabled={pending}>
              Mark under review
            </Button>
          )}
        </div>
      )}

      {canFulfil && status === "APPROVED" && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={() => setDialog("ship")} disabled={pending}>
            {replacement ? "Record replacement shipment" : "Record return pickup"}
          </Button>
          <Button size="sm" onClick={() => setDialog("complete")} disabled={pending}>
            Complete
          </Button>
        </div>
      )}
      {canFulfil && status === "RETURN_IN_TRANSIT" && (
        <Button variant="primary" size="sm" onClick={() => setDialog("received")} disabled={pending}>
          Mark return received
        </Button>
      )}
      {canFulfil && (status === "REPLACEMENT_SHIPPED" || status === "RECEIVED") && (
        <Button variant="primary" size="sm" onClick={() => setDialog("complete")} disabled={pending}>
          Complete claim
        </Button>
      )}

      <Dialog
        open={decision !== null}
        onClose={() => setDecision(null)}
        title={decision ? DECISION_COPY[decision].title : "Decide claim"}
        description={decision && decision !== "UNDER_REVIEW" ? "The customer is emailed and the ticket moves to their side." : undefined}
        size="sm"
      >
        {decision && (
          <DecisionForm
            decision={decision}
            replacement={replacement}
            onCancel={() => setDecision(null)}
            onSubmit={async (note, override) => {
              const r = await decideClaimAction(claimId, decision, note, override);
              if (r.ok) {
                setDecision(null);
                report(r, "Claim updated");
              }
              return r;
            }}
          />
        )}
      </Dialog>

      <Dialog
        open={dialog === "ship"}
        onClose={() => setDialog(null)}
        title={replacement ? "Record replacement shipment" : "Record return pickup"}
        description={
          replacement
            ? "Enter the courier AWB, or the replacement order if one was created. Without an order, stock is reduced here once."
            : "Enter the return pickup AWB. It's tracked as a return shipment."
        }
        size="sm"
      >
        <ShipmentForm
          replacement={replacement}
          onCancel={() => setDialog(null)}
          onSubmit={async (awb, orderId) => {
            const r = await recordShipmentAction(claimId, awb, orderId);
            if (r.ok) {
              setDialog(null);
              report(r, "Shipment recorded");
            }
            return r;
          }}
        />
      </Dialog>

      <Dialog open={dialog === "received"} onClose={() => setDialog(null)} title="Mark return received" size="sm">
        <NoteForm
          label="Condition of the returned item"
          hint="Required — e.g. 'Unopened, box intact' or 'Used, remote missing'."
          submitLabel="Mark received"
          minLength={3}
          onCancel={() => setDialog(null)}
          onSubmit={async (note) => {
            const r = await returnReceivedAction(claimId, note);
            if (r.ok) {
              setDialog(null);
              report(r, "Return received");
            }
            return r;
          }}
        />
      </Dialog>

      <ConfirmDialog
        open={dialog === "complete"}
        onClose={() => setDialog(null)}
        tone="default"
        title="Complete this claim?"
        description="Use this once the customer has their replacement, or the return is settled."
        confirmLabel="Complete claim"
        busy={pending}
        onConfirm={() =>
          startTransition(async () => {
            const r = await completeClaimAction(claimId);
            if (r.ok) setDialog(null);
            report(r, "Claim completed");
          })
        }
      />
    </div>
  );
}

function DecisionForm({
  decision,
  replacement,
  onCancel,
  onSubmit,
}: {
  decision: Decision;
  replacement: boolean;
  onCancel: () => void;
  onSubmit: (note: string, overrideStock: boolean) => Promise<DeskResult>;
}) {
  const copy = DECISION_COPY[decision];
  const [note, setNote] = useState("");
  const [override, setOverride] = useState(false);
  const [outOfStock, setOutOfStock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const noteRequired = copy.required || override;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await onSubmit(note, override);
          if (!r.ok) {
            setError(r.error);
            if (r.code === "OUT_OF_STOCK") setOutOfStock(true);
          }
        });
      }}
    >
      {error && (
        <p role="alert" className="rounded-lg bg-tone-neg-bg px-3 py-2 text-[13px] leading-5 text-tone-neg">
          {error}
        </p>
      )}
      <Field
        label={override ? "Why approve without stock?" : copy.label}
        htmlFor="claim-note"
        hint={override ? "Required — e.g. 'Restock arriving Friday, customer agreed to wait'. The customer sees this note." : copy.hint}
        optional={!noteRequired}
      >
        <Textarea
          id="claim-note"
          data-autofocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={1000}
          required={noteRequired}
          minLength={noteRequired ? 5 : undefined}
        />
      </Field>
      {decision === "APPROVE" && replacement && outOfStock && (
        <label className="flex items-start gap-2.5 rounded-lg border border-tone-warn/30 bg-tone-warn-bg px-3 py-2.5 text-[13px] leading-5 text-brand-ink">
          <input
            type="checkbox"
            checked={override}
            onChange={(e) => setOverride(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand-ink"
          />
          <span>
            <span className="font-semibold">Override the stock check.</span> Only when stock is definitely arriving — otherwise offer a refund
            instead.
          </span>
        </label>
      )}
      <div className="-mx-4 -mb-4 flex justify-end gap-2 border-t border-admin-line px-4 py-3 sm:-mx-5 sm:px-5">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant={decision === "REJECT" ? "danger" : "primary"} loading={pending}>
          {decision === "APPROVE" ? (override ? "Approve with override" : "Approve") : copy.title}
        </Button>
      </div>
    </form>
  );
}

function ShipmentForm({
  replacement,
  onCancel,
  onSubmit,
}: {
  replacement: boolean;
  onCancel: () => void;
  onSubmit: (awb: string, orderId: string) => Promise<DeskResult>;
}) {
  const [awb, setAwb] = useState("");
  const [orderId, setOrderId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await onSubmit(awb, orderId);
          if (!r.ok) setError(r.error);
        });
      }}
    >
      <Field label="AWB" htmlFor="claim-awb" optional={replacement}>
        <Input id="claim-awb" data-autofocus value={awb} onChange={(e) => setAwb(e.target.value)} className="font-mono" autoComplete="off" spellCheck={false} />
      </Field>
      {replacement && (
        <Field label="Replacement order ID" htmlFor="claim-order" optional hint="If the replacement went out as its own order (stock is handled by that order).">
          <Input
            id="claim-order"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder="PRC-…"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      )}
      {error && (
        <p role="alert" className="text-xs text-tone-neg">
          {error}
        </p>
      )}
      <div className="-mx-4 -mb-4 flex justify-end gap-2 border-t border-admin-line px-4 py-3 sm:-mx-5 sm:px-5">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending} disabled={!awb.trim() && !orderId.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}

export function NoteForm({
  label,
  hint,
  submitLabel,
  minLength,
  danger,
  mono,
  onCancel,
  onSubmit,
}: {
  label: string;
  hint?: string;
  submitLabel: string;
  minLength: number;
  danger?: boolean;
  mono?: boolean;
  onCancel: () => void;
  onSubmit: (note: string) => Promise<DeskResult>;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await onSubmit(note);
          if (!r.ok) setError(r.error);
        });
      }}
    >
      <Field label={label} htmlFor="note-form" hint={hint} error={error}>
        {mono ? (
          <Input
            id="note-form"
            data-autofocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required
            minLength={minLength}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        ) : (
          <Textarea id="note-form" data-autofocus value={note} onChange={(e) => setNote(e.target.value)} rows={3} required minLength={minLength} maxLength={1000} />
        )}
      </Field>
      <div className="-mx-4 -mb-4 flex justify-end gap-2 border-t border-admin-line px-4 py-3 sm:-mx-5 sm:px-5">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant={danger ? "danger" : "primary"} loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
