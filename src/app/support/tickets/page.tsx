import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Ticket } from "lucide-react";
import { getSupportSession, maskEmail } from "@/lib/support/session";
import { listCustomerTickets } from "@/lib/support/tickets";
import { TICKET_STATUS_LABEL, isTicketStatus } from "@/lib/support/rules";
import SupportShell from "../_components/SupportShell";
import { Eyebrow, StatusPill, btnDark, btnOutline, btnPrimary, cardClass, fmtDate, inputClass } from "../_components/ui";

export const metadata: Metadata = {
  title: { absolute: "Your requests — PRC Support" },
  robots: { index: false },
};

type SP = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const TICKET_RE = /^T-[A-Z0-9]{6}$/;

export default async function SupportTicketsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const lookup = first(sp.number).trim().toUpperCase().slice(0, 12);
  // "T7KQ2M9" → "T-7KQ2M9", for people who skip the dash.
  const normalised = /^T[A-Z0-9]{6}$/.test(lookup) ? `T-${lookup.slice(1)}` : lookup;
  if (lookup && TICKET_RE.test(normalised)) redirect(`/support/tickets/${normalised}`);
  const lookupError = lookup ? "Ticket numbers look like T-7KQ2M9. Check the email we sent you." : null;

  const session = await getSupportSession();
  const tickets = session ? await listCustomerTickets(session.customerId) : [];

  return (
    <SupportShell crumbs={[{ label: "Tickets" }]}>
      <section className="max-w-3xl mx-auto px-4 py-8 sm:py-12 space-y-6">
        <header>
          <Eyebrow>Your requests</Eyebrow>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold text-brand-ink">Support tickets</h1>
        </header>

        <div className={`${cardClass} bg-brand-cream`}>
          <h2 className="font-display text-lg font-bold text-brand-ink">Find a ticket</h2>
          <form action="/support/tickets" method="get" className="mt-3 flex flex-col sm:flex-row gap-2">
            <label htmlFor="ticket-lookup" className="sr-only">
              Ticket number
            </label>
            <input
              id="ticket-lookup"
              name="number"
              type="text"
              required
              maxLength={12}
              defaultValue={lookup}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="T-7KQ2M9"
              aria-invalid={lookupError ? true : undefined}
              aria-describedby={lookupError ? "ticket-lookup-error" : undefined}
              className={`${inputClass} min-w-0 flex-1 font-mono uppercase`}
            />
            <button type="submit" className={`${btnDark} shrink-0`}>
              Check status
            </button>
          </form>
          {lookupError && (
            <p id="ticket-lookup-error" role="alert" className="mt-2 text-sm font-medium text-brand-red">
              {lookupError}
            </p>
          )}
          <p className="mt-3 text-xs text-brand-ink-soft">
            The private link in your confirmation email opens the ticket directly.
          </p>
        </div>

        {session ? (
          <section aria-labelledby="my-tickets" className={cardClass}>
            <h2 id="my-tickets" className="flex items-center gap-2 font-display text-lg font-bold text-brand-ink">
              <Ticket size={18} aria-hidden className="text-brand-red" />
              Requests for {maskEmail(session.email)}
            </h2>
            {tickets.length === 0 ? (
              <p className="mt-2 text-sm text-brand-ink-soft">You haven&apos;t raised any requests yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-brand-line">
                {tickets.map((t) => (
                  <li key={t.number}>
                    <Link href={`/support/tickets/${t.number}`} className="flex min-h-16 items-center gap-3 py-3 hover:text-brand-red">
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-xs text-brand-ink-soft">
                          {t.number}
                          {t.orderId ? ` · ${t.orderId}` : ""} · updated {fmtDate(t.updatedAt)}
                        </span>
                        <span className="block font-semibold text-brand-ink break-words">{t.subject}</span>
                      </span>
                      <StatusPill status={t.status} label={isTicketStatus(t.status) ? TICKET_STATUS_LABEL[t.status] : t.status} />
                      <ChevronRight size={18} aria-hidden className="shrink-0 text-brand-ink-soft" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/support/new" className={`${btnPrimary} mt-4 w-full`}>
              Raise a new request
            </Link>
          </section>
        ) : (
          <section className={cardClass}>
            <h2 className="font-display text-lg font-bold text-brand-ink">See all your requests</h2>
            <p className="mt-2 text-sm text-brand-ink-soft">
              Verify one of your orders and we&apos;ll list every request linked to you.
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-3">
              <Link href="/support/order" className={`${btnPrimary} flex-1`}>
                Verify my order
              </Link>
              <Link href="/support/new" className={`${btnOutline} flex-1`}>
                Raise a new request
              </Link>
            </div>
          </section>
        )}
      </section>
    </SupportShell>
  );
}
