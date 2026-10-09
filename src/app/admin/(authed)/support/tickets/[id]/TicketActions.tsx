"use client";

import { useState, useTransition } from "react";
import { ArrowUpRight, Reply } from "lucide-react";
import { Button, ButtonLink } from "@/components/admin/Button";
import { Dialog } from "@/components/admin/Dialog";
import { Field, Select, Textarea } from "@/components/admin/Field";
import { useToast } from "@/components/admin/Toast";
import { PRIORITIES, PRIORITY_LABEL } from "../../ticket-ui";
import { assignAction, changePriorityAction, changeStatusAction, escalateAction, type DeskResult } from "./actions";

type Option = { value: string; label: string };

/**
 * Ticket header actions: assignee select, status change, priority change and
 * escalation. Controls the role can't use are not rendered; the server
 * actions re-check every permission.
 */
export function TicketActions({
  ticketId,
  status,
  priority,
  assignedTo,
  staff,
  statusTargets,
  canAssign,
  canReply,
}: {
  ticketId: string;
  status: string;
  priority: string;
  assignedTo: string | null;
  staff: Option[];
  statusTargets: Option[];
  canAssign: boolean;
  canReply: boolean;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"status" | "priority" | "escalate" | null>(null);
  const closed = status === "CLOSED";
  // Optimistic: show the pick at once, roll back if the server refuses.
  const [assignee, setAssignee] = useState(assignedTo ?? "");

  function report(r: DeskResult, okTitle: string) {
    if (r.ok) toast({ title: okTitle, description: r.message, tone: "success" });
    else toast({ title: "Couldn't complete that", description: r.error, tone: "error" });
  }

  const staffOptions = assignedTo && !staff.some((s) => s.value === assignedTo) ? [...staff, { value: assignedTo, label: `${assignedTo} (inactive)` }] : staff;

  return (
    <>
      {canAssign && (
        <label className="relative inline-flex items-center">
          <span className="sr-only">Assignee</span>
          <Select
            value={assignee}
            disabled={pending || closed}
            onChange={(e) => {
              const prev = assignee;
              const next = e.target.value;
              setAssignee(next);
              startTransition(async () => {
                const r = await assignAction(ticketId, next || null);
                if (!r.ok) setAssignee(prev);
                report(r, next ? "Assigned" : "Unassigned");
              });
            }}
            className="min-w-44 max-w-56"
          >
            <option value="">Unassigned</option>
            {staffOptions.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>
      )}
      {canReply && statusTargets.length > 0 && (
        <Button onClick={() => setDialog("status")} disabled={pending}>
          Change status
        </Button>
      )}
      {canAssign && !closed && (
        <Button onClick={() => setDialog("priority")} disabled={pending}>
          Priority
        </Button>
      )}
      {canReply && !["ESCALATED", "RESOLVED", "CLOSED"].includes(status) && (
        <Button onClick={() => setDialog("escalate")} disabled={pending} icon={<ArrowUpRight size={15} aria-hidden />}>
          Escalate
        </Button>
      )}
      {canReply && !closed && (
        <ButtonLink href="#composer" variant="primary" icon={<Reply size={15} aria-hidden />}>
          Reply
        </ButtonLink>
      )}

      <Dialog open={dialog === "status"} onClose={() => setDialog(null)} title="Change status" size="sm">
        <ReasonForm
          kind="status"
          options={statusTargets}
          noteLabel="Note"
          noteHint="Optional. Kept in the activity log; a resolve note is also emailed to the customer."
          noteRequired={false}
          submitLabel="Update status"
          onCancel={() => setDialog(null)}
          onSubmit={async (to, note) => {
            const r = await changeStatusAction(ticketId, to, note);
            if (r.ok) setDialog(null);
            report(r, "Status updated");
            return r;
          }}
        />
      </Dialog>
      <Dialog
        open={dialog === "priority"}
        onClose={() => setDialog(null)}
        title="Change priority"
        description="SLA targets are recalculated from when the ticket was opened."
        size="sm"
      >
        <ReasonForm
          kind="priority"
          options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
          initial={priority}
          noteLabel="Reason"
          noteHint="Required — shown to the team as the priority reason."
          noteRequired
          submitLabel="Update priority"
          onCancel={() => setDialog(null)}
          onSubmit={async (p, note) => {
            const r = await changePriorityAction(ticketId, p, note);
            if (r.ok) setDialog(null);
            report(r, "Priority updated");
            return r;
          }}
        />
      </Dialog>
      <Dialog
        open={dialog === "escalate"}
        onClose={() => setDialog(null)}
        title="Escalate ticket"
        description="Raises priority to at least High and alerts the team."
        size="sm"
      >
        <ReasonForm
          kind="escalate"
          noteLabel="Why does it need escalating?"
          noteRequired
          submitLabel="Escalate"
          onCancel={() => setDialog(null)}
          onSubmit={async (_v, note) => {
            const r = await escalateAction(ticketId, note);
            if (r.ok) setDialog(null);
            report(r, "Escalated");
            return r;
          }}
        />
      </Dialog>
    </>
  );
}

function ReasonForm({
  kind,
  options,
  initial,
  noteLabel,
  noteHint,
  noteRequired,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  kind: string;
  options?: Option[];
  initial?: string;
  noteLabel: string;
  noteHint?: string;
  noteRequired: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (value: string, note: string) => Promise<DeskResult>;
}) {
  const [value, setValue] = useState(initial ?? options?.[0]?.value ?? "");
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
          const r = await onSubmit(value, note);
          if (!r.ok) setError(r.error);
        });
      }}
    >
      {options && (
        <Field label={kind === "status" ? "New status" : "Priority"} htmlFor={`${kind}-value`}>
          <Select id={`${kind}-value`} value={value} onChange={(e) => setValue(e.target.value)} data-autofocus>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={noteLabel} htmlFor={`${kind}-note`} hint={noteHint} error={error} optional={!noteRequired}>
        <Textarea
          id={`${kind}-note`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={300}
          required={noteRequired}
          minLength={noteRequired ? 5 : undefined}
          data-autofocus={options ? undefined : true}
        />
      </Field>
      <div className="-mx-4 -mb-4 flex justify-end gap-2 border-t border-admin-line px-4 py-3 sm:-mx-5 sm:px-5">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending} disabled={!value && !!options}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
