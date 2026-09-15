"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/admin/Button";
import { Field, Input, Textarea } from "@/components/admin/Field";
import { Panel, PanelHeader } from "@/components/admin/Panel";
import { useToast } from "@/components/admin/Toast";
import { updateCustomer } from "./actions";

/**
 * Inline CRM editor for a customer's name, email, and notes. Calls the
 * updateCustomer server action, which validates + persists and revalidates the
 * profile. Notes had no edit UI before this — it's the whole point of the card.
 */
export function CustomerEditForm({
  id,
  initialName,
  initialEmail,
  initialNotes,
}: {
  id: string;
  initialName: string | null;
  initialEmail: string | null;
  initialNotes: string | null;
}) {
  const [name, setName] = useState(initialName ?? "");
  const [email, setEmail] = useState(initialEmail ?? "");
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  // Baseline so we can disable Save until something actually changes and show a
  // subtle "unsaved" hint.
  const dirty =
    name !== (initialName ?? "") ||
    email !== (initialEmail ?? "") ||
    notes !== (initialNotes ?? "");

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateCustomer(id, { name, email, notes });
      if (res.ok) {
        toast({ title: "Customer details saved", tone: "success" });
      } else {
        setError(res.error ?? "Save failed.");
      }
    });
  }

  return (
    <Panel>
      <PanelHeader title="CRM notes" description="Name, email and internal notes" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="space-y-4 p-4 sm:p-5"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <Field label="Name" htmlFor="cust-name">
            <Input
              id="cust-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
              maxLength={120}
              placeholder="Customer name"
              autoComplete="off"
            />
          </Field>
          <Field label="Email" htmlFor="cust-email">
            <Input
              id="cust-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
              maxLength={200}
              placeholder="name@example.com"
              autoComplete="off"
            />
          </Field>
        </div>

        <Field label="Internal notes" htmlFor="cust-notes" hint="Only your team can see these notes.">
          <Textarea
            id="cust-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={pending}
            rows={4}
            maxLength={5000}
            placeholder="Call history, preferences, follow-ups. Never shown to the customer."
            className="resize-y"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            loading={pending}
            disabled={!dirty}
            icon={<Check size={15} aria-hidden />}
          >
            {pending ? "Saving…" : "Save changes"}
          </Button>
          {error ? (
            <p role="alert" className="min-w-0 text-[13px] leading-5 text-tone-neg">
              {error}
            </p>
          ) : (
            dirty && !pending && <span className="text-xs text-admin-muted">Unsaved changes</span>
          )}
        </div>
      </form>
    </Panel>
  );
}
