"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { CATEGORY_KEYS, TICKET_CATEGORIES } from "@/lib/support/rules";
import { Button, type ButtonVariant } from "@/components/admin/Button";
import { Dialog } from "@/components/admin/Dialog";
import { Field, Input, Select, Textarea } from "@/components/admin/Field";
import { useToast } from "@/components/admin/Toast";
import { createTicketAction } from "./actions";

/**
 * "New ticket" — staff raise a ticket for a customer who called or messaged.
 * Contact details default from the order when an order ID is given.
 */
export function NewTicketButton({ variant = "primary" }: { variant?: ButtonVariant }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} icon={<Plus size={15} aria-hidden />} onClick={() => setOpen(true)} className="max-sm:w-11 max-sm:px-0">
        <span className="max-sm:sr-only">New ticket</span>
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New ticket"
        description="Raise a request on a customer's behalf. They get the usual confirmation email with a link to follow it."
      >
        <NewTicketForm onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function NewTicketForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("GENERAL");
  const needsOrder = TICKET_CATEGORIES[category as keyof typeof TICKET_CATEGORIES]?.needsOrder ?? false;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        startTransition(async () => {
          const r = await createTicketAction(fd);
          if (!r.ok) {
            setError(r.error);
            return;
          }
          toast({ title: `Ticket ${r.number} created`, tone: "success" });
          onDone();
          router.push(`/admin/support/tickets/${r.id}`);
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" htmlFor="nt-category">
          <Select id="nt-category" name="category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORY_KEYS.map((k) => (
              <option key={k} value={k}>
                {TICKET_CATEGORIES[k].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Order ID" htmlFor="nt-order" optional={!needsOrder} hint={needsOrder ? "Required for this category" : undefined}>
          <Input id="nt-order" name="orderId" placeholder="PRC-…" autoComplete="off" spellCheck={false} className="font-mono" required={needsOrder} />
        </Field>
      </div>
      <Field label="Subject" htmlFor="nt-subject" optional hint="Defaults to the category name">
        <Input id="nt-subject" name="subject" maxLength={140} />
      </Field>
      <Field label="What's the problem?" htmlFor="nt-desc" hint="In the customer's words where possible — this becomes the first message.">
        <Textarea id="nt-desc" name="description" required minLength={10} maxLength={4000} rows={4} />
      </Field>
      <fieldset className="space-y-3">
        <legend className="text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">Contact</legend>
        <p className="text-xs text-admin-muted">Leave blank to use the order&rsquo;s contact. An email or phone is required.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name" htmlFor="nt-name" optional>
            <Input id="nt-name" name="name" autoComplete="off" />
          </Field>
          <Field label="Email" htmlFor="nt-email" optional>
            <Input id="nt-email" name="email" type="email" autoComplete="off" />
          </Field>
          <Field label="Phone" htmlFor="nt-phone" optional>
            <Input id="nt-phone" name="phone" type="tel" inputMode="tel" autoComplete="off" />
          </Field>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="rounded-lg bg-tone-neg-bg px-3 py-2 text-[13px] text-tone-neg">
          {error}
        </p>
      )}
      <div className="-mx-4 -mb-4 flex justify-end gap-2 border-t border-admin-line px-4 py-3 sm:-mx-5 sm:px-5">
        <Button variant="secondary" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          Create ticket
        </Button>
      </div>
    </form>
  );
}
