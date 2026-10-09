"use client";

import { useState, useTransition } from "react";
import { IndianRupee } from "lucide-react";
import { Button } from "@/components/admin/Button";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { Dialog } from "@/components/admin/Dialog";
import { Field, PrefixInput, Select, Textarea } from "@/components/admin/Field";
import { useToast } from "@/components/admin/Toast";
import { NoteForm } from "./ClaimActions";
import {
  approveRefundAction,
  reconcileRefundAction,
  recordTransferAction,
  rejectRefundAction,
  requestRefundAction,
  type DeskResult,
} from "./actions";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/**
 * "Request refund" (refunds.request). The idempotency key is minted on the
 * server for each render of the ticket page and sent as a hidden field, so a
 * double click or a retried request creates one refund case, not two. After a
 * successful request the page re-renders with a fresh key.
 */
export function RequestRefundButton({
  ticketId,
  claimId,
  idempotencyKey,
  defaultAmount,
  defaultMethod,
  onlineRoom,
  remaining,
}: {
  ticketId: string;
  claimId: string | null;
  idempotencyKey: string;
  defaultAmount: number;
  defaultMethod: "RAZORPAY" | "MANUAL";
  onlineRoom: number;
  remaining: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" icon={<IndianRupee size={14} aria-hidden />} onClick={() => setOpen(true)} disabled={remaining <= 0}>
        Request refund
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Request refund"
        description="Finance (owner) approves and executes it. Nothing is sent to the customer until then."
        size="sm"
      >
        <RequestForm
          ticketId={ticketId}
          claimId={claimId}
          idempotencyKey={idempotencyKey}
          defaultAmount={defaultAmount}
          defaultMethod={defaultMethod}
          onlineRoom={onlineRoom}
          remaining={remaining}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

function RequestForm({
  ticketId,
  claimId,
  idempotencyKey,
  defaultAmount,
  defaultMethod,
  onlineRoom,
  remaining,
  onDone,
}: {
  ticketId: string;
  claimId: string | null;
  idempotencyKey: string;
  defaultAmount: number;
  defaultMethod: "RAZORPAY" | "MANUAL";
  onlineRoom: number;
  remaining: number;
  onDone: () => void;
}) {
  const toast = useToast();
  const [method, setMethod] = useState(defaultMethod);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        startTransition(async () => {
          const r = await requestRefundAction(fd);
          if (!r.ok) {
            setError(r.error);
            return;
          }
          toast({ title: "Refund requested", description: r.message, tone: "success" });
          onDone();
        });
      }}
    >
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {claimId && <input type="hidden" name="claimId" value={claimId} />}
      <Field
        label="Amount"
        htmlFor="refund-amount"
        hint={`${inr(remaining)} left on the order${onlineRoom > 0 ? ` · up to ${inr(onlineRoom)} via Razorpay` : " · no captured online payment"}`}
      >
        <PrefixInput id="refund-amount" name="amount" defaultValue={String(defaultAmount)} required data-autofocus />
      </Field>
      <Field
        label="How the money goes back"
        htmlFor="refund-method"
        hint={
          method === "RAZORPAY"
            ? "Refunded to the original payment via Razorpay. Marked done only when Razorpay confirms."
            : "Finance sends a bank/UPI transfer and records its UTR. It's never shown as Razorpay-confirmed."
        }
      >
        <Select id="refund-method" name="method" value={method} onChange={(e) => setMethod(e.target.value as "RAZORPAY" | "MANUAL")}>
          <option value="RAZORPAY" disabled={onlineRoom <= 0}>
            Razorpay — original payment{onlineRoom <= 0 ? " (not available)" : ""}
          </option>
          <option value="MANUAL">Bank/UPI transfer by finance</option>
        </Select>
      </Field>
      <Field label="Reason" htmlFor="refund-reason" hint="Seen by finance and kept in the audit log.">
        <Textarea id="refund-reason" name="reason" rows={3} required minLength={5} maxLength={500} />
      </Field>
      {error && (
        <p role="alert" className="rounded-lg bg-tone-neg-bg px-3 py-2 text-[13px] leading-5 text-tone-neg">
          {error}
        </p>
      )}
      <div className="-mx-4 -mb-4 flex justify-end gap-2 border-t border-admin-line px-4 py-3 sm:-mx-5 sm:px-5">
        <Button variant="secondary" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          Request refund
        </Button>
      </div>
    </form>
  );
}

/** Finance actions on one refund case (refunds.approve — owner / finance). */
export function RefundCaseActions({
  refundId,
  ticketId,
  status,
  method,
  amountInr,
}: {
  refundId: string;
  ticketId: string;
  status: string;
  method: string;
  amountInr: number;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"approve" | "transfer" | "reject" | null>(null);

  function report(r: DeskResult, okTitle: string) {
    if (r.ok) toast({ title: okTitle, description: r.message, tone: "success" });
    else toast({ title: "Couldn't complete that", description: r.error, tone: "error" });
  }

  const razorpay = method === "RAZORPAY";
  const canApprove = status === "REQUESTED";
  const canTransfer = !razorpay && status === "APPROVED";
  const canReject = status === "REQUESTED" || status === "APPROVED";
  const canReconcile = razorpay && (status === "PROCESSING" || status === "FAILED");
  if (!canApprove && !canTransfer && !canReject && !canReconcile) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {canApprove && (
        <Button size="sm" variant="primary" onClick={() => setDialog("approve")} disabled={pending}>
          {razorpay ? "Approve & execute" : "Approve"}
        </Button>
      )}
      {canTransfer && (
        <Button size="sm" variant="primary" onClick={() => setDialog("transfer")} disabled={pending}>
          Record transfer reference
        </Button>
      )}
      {canReconcile && (
        <Button
          size="sm"
          onClick={() => startTransition(async () => report(await reconcileRefundAction(refundId, ticketId), "Checked with Razorpay"))}
          loading={pending && dialog === null}
          disabled={pending}
        >
          Check with Razorpay
        </Button>
      )}
      {canReject && (
        <Button size="sm" variant="ghost" onClick={() => setDialog("reject")} disabled={pending}>
          Reject
        </Button>
      )}

      <ConfirmDialog
        open={dialog === "approve"}
        onClose={() => setDialog(null)}
        tone="default"
        title={razorpay ? `Refund ${inr(amountInr)} through Razorpay?` : `Approve ${inr(amountInr)} bank/UPI refund?`}
        description={
          razorpay
            ? "Razorpay is asked to refund the original payment now. This can't be undone. It's marked done only when Razorpay confirms."
            : "Approve, then make the transfer and record its UTR here."
        }
        confirmLabel={razorpay ? "Approve & execute" : "Approve"}
        busy={pending}
        onConfirm={() =>
          startTransition(async () => {
            const r = await approveRefundAction(refundId, ticketId);
            setDialog(null);
            report(r, razorpay ? "Refund sent to Razorpay" : "Refund approved");
          })
        }
      />
      <Dialog open={dialog === "transfer"} onClose={() => setDialog(null)} title="Record transfer reference" size="sm">
        <NoteForm
          label="Bank / UPI transaction reference (UTR)"
          hint="6–60 letters or digits, exactly as on the bank statement."
          submitLabel="Record transfer"
          minLength={6}
          mono
          onCancel={() => setDialog(null)}
          onSubmit={async (ref) => {
            const r = await recordTransferAction(refundId, ticketId, ref);
            if (r.ok) {
              setDialog(null);
              report(r, "Transfer recorded");
            }
            return r;
          }}
        />
      </Dialog>
      <Dialog open={dialog === "reject"} onClose={() => setDialog(null)} title="Reject refund" size="sm">
        <NoteForm
          label="Reason"
          hint="Required — kept in the audit log."
          submitLabel="Reject refund"
          minLength={5}
          danger
          onCancel={() => setDialog(null)}
          onSubmit={async (reason) => {
            const r = await rejectRefundAction(refundId, ticketId, reason);
            if (r.ok) {
              setDialog(null);
              report(r, "Refund rejected");
            }
            return r;
          }}
        />
      </Dialog>
    </div>
  );
}
