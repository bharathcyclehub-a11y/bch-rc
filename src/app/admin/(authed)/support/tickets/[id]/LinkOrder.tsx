"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/admin/Button";
import { Input } from "@/components/admin/Field";
import { useToast } from "@/components/admin/Toast";
import { linkOrderAction, type DeskResult } from "./actions";

export type OrderLead = {
  id: string;
  placed: string;
  status: string;
  total: string;
  payment: string;
  items: string;
  matches: Array<"phone" | "email">;
};

const MATCH_LABEL = { phone: "phone", email: "email" } as const;

/**
 * "Which order is this about?" for tickets raised without an order ID: orders
 * placed with the ticket's phone/email, each linkable in one click, plus a
 * box for an ID the customer gives later. Linking is staff-side only.
 */
export function LinkOrder({ ticketId, leads, canLink }: { ticketId: string; leads: OrderLead[]; canLink: boolean }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  function link(orderId: string) {
    setBusy(orderId);
    startTransition(async () => {
      const r: DeskResult = await linkOrderAction(ticketId, orderId);
      setBusy(null);
      if (r.ok) toast({ title: "Order linked", description: r.message, tone: "success" });
      else toast({ title: "Couldn't link that order", description: r.error, tone: "error" });
    });
  }

  return (
    <>
      {leads.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-admin-muted sm:px-5">No orders on this store use the ticket&apos;s phone or email. Ask the customer for their order ID.</p>
      ) : (
        <ul className="divide-y divide-admin-line">
          {leads.map((o) => (
            <li key={o.id} className="flex items-start gap-3 px-4 py-2.5 text-[13px] sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/admin/orders/${o.id}`} className="font-mono text-xs font-semibold text-brand-ink hover:underline">
                    {o.id}
                  </Link>
                  <span className="text-xs text-admin-muted">{o.placed}</span>
                </p>
                <p className="truncate text-brand-ink" title={o.items}>
                  {o.items || "—"}
                </p>
                <p className="text-xs text-admin-muted">
                  {o.status} · {o.total} · {o.payment} · matches {o.matches.map((m) => MATCH_LABEL[m]).join(" + ")}
                </p>
              </div>
              {canLink && (
                <Button size="sm" onClick={() => link(o.id)} loading={pending && busy === o.id} disabled={pending}>
                  Link
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canLink && (
        <form
          className="flex gap-2 border-t border-admin-line px-4 py-3 sm:px-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) link(typed);
          }}
        >
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Or enter order ID, e.g. PRC-A1B2C3D4"
            aria-label="Order ID"
            className="font-mono"
          />
          <Button type="submit" size="sm" loading={pending && busy === typed} disabled={pending || !typed.trim()}>
            Link
          </Button>
        </form>
      )}
    </>
  );
}
