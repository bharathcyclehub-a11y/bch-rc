import type { Metadata } from "next";
import Link from "next/link";
import {
  Check,
  Clock,
  FileVideo,
  Info,
  Lock,
  MessageSquareWarning,
  Paperclip,
  ReceiptText,
  RefreshCw,
} from "lucide-react";
import { getSupportSession } from "@/lib/support/session";
import { customerTicketView, findTicketForCustomer, type CustomerTicketView } from "@/lib/support/tickets";
import { REOPEN_WINDOW_DAYS, loadPolicy } from "@/lib/support/config";
import { DEFAULT_POLICY } from "@/lib/support/rules";
import { EVIDENCE_ACCEPT, MAX_EVIDENCE_BYTES, MAX_EVIDENCE_FILES } from "@/lib/support/evidence";
import { formatINR } from "@/lib/utils";
import SupportShell from "../../_components/SupportShell";
import {
  Eyebrow,
  Notice,
  REPLY_PROMISE,
  SUPPORT_HOURS,
  StatusPill,
  WhatsAppButton,
  btnDark,
  btnPrimary,
  cardClass,
  fmtDateTime,
  inputClass,
} from "../../_components/ui";
import TicketReply from "./TicketReply";
import TicketControls from "./TicketControls";

export const metadata: Metadata = {
  title: { absolute: "Your request — PRC Support" },
  robots: { index: false, follow: false },
};

type SP = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const STAGES = ["Received", "Reviewing", "Resolution proposed", "Resolved"] as const;

export default async function TicketPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: SP }) {
  const [{ number: rawNumber }, sp] = await Promise.all([params, searchParams]);
  const number = rawNumber.trim().toUpperCase().slice(0, 12);
  const token = first(sp.k).slice(0, 64) || null;
  const created = first(sp.created) === "1";

  const session = await getSupportSession();
  const row = await findTicketForCustomer(number, { sessionCustomerId: session?.customerId ?? null, token });

  if (!row) return <NoAccess number={number} />;

  const [view, policy] = await Promise.all([customerTicketView(row), loadPolicy().catch(() => DEFAULT_POLICY)]);
  const linkToken = session && row.customerId === session.customerId ? null : token;
  const fileUrl = (id: string) =>
    `/api/support/evidence/${id}?t=${encodeURIComponent(view.number)}${linkToken ? `&k=${encodeURIComponent(linkToken)}` : ""}`;

  return (
    <SupportShell crumbs={[{ label: "Tickets", href: "/support/tickets" }, { label: view.number }]}>
      <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12 space-y-6">
        {created && (
          <Notice tone="success" role="status" title={`Request ${view.number} received`}>
            We&apos;ve emailed you a private link to this page. Keep it to check progress, reply or add photos.
          </Notice>
        )}

        {/* ── Header + progress ──────────────────────────────────────── */}
        <section aria-labelledby="ticket-title" className={`${cardClass} bg-brand-cream`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <Eyebrow>Ticket {view.number}</Eyebrow>
            <span className="font-mono text-xs text-brand-ink-soft">{fmtDateTime(view.createdAt)}</span>
          </div>
          <h1 id="ticket-title" className="mt-2 font-display text-2xl sm:text-3xl font-bold text-brand-ink break-words">
            {view.subject}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill status={view.status} label={view.statusLabel} />
            <span className="text-xs text-brand-ink-soft">{view.category}</span>
            {view.orderId && (
              <Link
                href={`/support/order/${view.orderId}`}
                className="inline-flex min-h-12 items-center gap-1 rounded-full px-2 font-mono text-xs font-semibold text-brand-ink underline underline-offset-4 hover:text-brand-red"
              >
                <ReceiptText size={14} aria-hidden />
                {view.orderId}
              </Link>
            )}
          </div>

          <Progress stage={view.stage} />

          <p className="mt-4 flex items-start gap-2 text-sm text-brand-ink">
            <Clock size={16} aria-hidden className="mt-0.5 shrink-0 text-brand-ink-soft" />
            <span>
              Support hours {SUPPORT_HOURS} · {REPLY_PROMISE}.
            </span>
          </p>
        </section>

        {view.awaitingCustomer && view.canReply && (
          <Notice tone="warn" role="status" title="We're waiting for your reply">
            Our team asked you something below. Reply here so we can keep going.{" "}
            <a href="#reply" className="font-semibold underline">
              Reply now
            </a>
          </Notice>
        )}

        {view.claim && <ClaimCard claim={view.claim} />}
        {view.refunds.length > 0 && <RefundCard refunds={view.refunds} />}

        {/* ── Thread ─────────────────────────────────────────────────── */}
        <section aria-labelledby="thread-heading">
          <h2 id="thread-heading" className="font-display text-lg font-bold text-brand-ink">
            Messages &amp; updates
          </h2>
          <ol className="mt-3 space-y-3">
            {view.messages.map((m) =>
              m.author === "Update" ? (
                <li key={m.id} className="flex items-start gap-2 px-2 text-sm text-brand-ink-soft">
                  <Info size={16} aria-hidden className="mt-0.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="break-words">{m.body}</span>{" "}
                    <time dateTime={m.at} className="whitespace-nowrap font-mono text-xs">
                      {fmtDateTime(m.at)}
                    </time>
                  </span>
                </li>
              ) : (
                <li
                  key={m.id}
                  className={`rounded-2xl border p-4 ${
                    m.author === "You" ? "border-brand-line bg-brand-cream sm:ml-10" : "border-brand-line border-l-4 border-l-brand-red bg-white sm:mr-10"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-sm font-bold text-brand-ink">{m.author === "You" ? "You" : "PRC Support"}</p>
                    <time dateTime={m.at} className="font-mono text-xs text-brand-ink-soft">
                      {fmtDateTime(m.at)}
                    </time>
                  </div>
                  <p className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-brand-ink">{m.body}</p>
                  {m.attachments.length > 0 && (
                    <div className="mt-3">
                      <p className="flex items-center gap-1 text-xs font-semibold text-brand-ink-soft">
                        <Paperclip size={14} aria-hidden />
                        {m.attachments.length} attachment{m.attachments.length === 1 ? "" : "s"}
                      </p>
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {m.attachments.map((a) => (
                          <li key={a.id}>
                            <a
                              href={fileUrl(a.id)}
                              target="_blank"
                              rel="noopener"
                              className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border border-brand-line bg-white hover:border-brand-ink"
                            >
                              {a.mimeType.startsWith("image/") ? (
                                // Private evidence behind an access-checked route — not optimisable by next/image.
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={fileUrl(a.id)} alt={a.name ? `Attachment: ${a.name}` : "Attached photo"} loading="lazy" className="h-full w-full object-cover" />
                              ) : (
                                <span className="flex flex-col items-center gap-1 text-xs font-semibold text-brand-ink">
                                  <FileVideo size={22} aria-hidden />
                                  Play video
                                </span>
                              )}
                              <span className="sr-only">(opens in a new tab)</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ),
            )}
          </ol>
        </section>

        {/* ── Reply / close / reopen ─────────────────────────────────── */}
        {view.canReply ? (
          <section id="reply" className={`${cardClass} scroll-mt-24`}>
            <TicketReply
              number={view.number}
              token={linkToken}
              accept={EVIDENCE_ACCEPT}
              maxFiles={Math.min(policy.maxEvidenceFiles, MAX_EVIDENCE_FILES)}
              maxMb={Math.min(policy.maxEvidenceMb, MAX_EVIDENCE_BYTES / (1024 * 1024))}
              awaitingCustomer={view.awaitingCustomer}
            />
          </section>
        ) : (
          <Notice tone="info" title="This request is closed">
            Need more help?{" "}
            <Link href={view.orderId ? `/support/new?order=${view.orderId}` : "/support/new"} className="font-semibold underline">
              Raise a new request
            </Link>
            .
          </Notice>
        )}

        <TicketControls
          number={view.number}
          token={linkToken}
          canClose={view.canClose}
          canReopen={view.canReopen}
          reopenDays={REOPEN_WINDOW_DAYS}
        />

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-brand-line p-4">
          <p className="flex-1 text-sm text-brand-ink-soft">
            Urgent? WhatsApp us with reference <span className="font-mono font-semibold text-brand-ink">{view.number}</span>.
          </p>
          <WhatsAppButton message={`Hi, I need an update on ticket ${view.number}.`} label="WhatsApp" />
        </div>
      </div>
    </SupportShell>
  );
}

function Progress({ stage }: { stage: CustomerTicketView["stage"] }) {
  return (
    <ol aria-label="Progress" className="mt-5 grid grid-cols-4 gap-1">
      {STAGES.map((label, i) => {
        const state = i < stage ? "done" : i === stage ? "current" : "upcoming";
        return (
          <li key={label} className="flex min-w-0 flex-col items-center text-center">
            <span
              aria-hidden
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                state === "done"
                  ? "bg-brand-ink text-white"
                  : state === "current"
                    ? "bg-brand-red text-white ring-4 ring-brand-red-soft"
                    : "border-2 border-neutral-300 bg-white text-neutral-400"
              }`}
            >
              {state === "done" ? <Check size={14} strokeWidth={3} /> : i + 1}
            </span>
            <span
              className={`mt-1.5 text-[11px] leading-tight break-words ${
                state === "current" ? "font-bold text-brand-red" : state === "done" ? "font-medium text-brand-ink" : "text-neutral-500"
              }`}
            >
              {label}
              <span className="sr-only">
                {" "}
                ({state === "done" ? "done" : state === "current" ? "current step" : "not yet"})
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ClaimCard({ claim }: { claim: NonNullable<CustomerTicketView["claim"]> }) {
  return (
    <section aria-labelledby="claim-heading" className={cardClass}>
      <div className="flex items-center gap-2">
        <RefreshCw size={18} aria-hidden className="text-brand-red" />
        <h2 id="claim-heading" className="font-display text-lg font-bold text-brand-ink">
          {claim.type} claim
        </h2>
        <span className="ml-auto font-mono text-xs text-brand-ink-soft">{claim.number}</span>
      </div>
      <dl className="mt-3 divide-y divide-brand-line text-sm">
        <div className="flex justify-between gap-4 py-2">
          <dt className="text-brand-ink-soft">Status</dt>
          <dd className="text-right font-semibold text-brand-ink">{claim.status}</dd>
        </div>
        {claim.eligibility && (
          <div className="flex justify-between gap-4 py-2">
            <dt className="shrink-0 text-brand-ink-soft">Policy check</dt>
            <dd className="text-right text-brand-ink">{claim.eligibility}</dd>
          </div>
        )}
      </dl>
      <p className="mt-2 text-xs text-brand-ink-soft">Our team reviews every claim and confirms the outcome here.</p>
    </section>
  );
}

function RefundCard({ refunds }: { refunds: CustomerTicketView["refunds"] }) {
  return (
    <section aria-labelledby="refund-heading" className={cardClass}>
      <h2 id="refund-heading" className="font-display text-lg font-bold text-brand-ink">
        Refunds
      </h2>
      <ul className="mt-3 divide-y divide-brand-line text-sm">
        {refunds.map((r, i) => (
          <li key={i} className="py-2">
            <div className="flex justify-between gap-4">
              <span className="font-semibold text-brand-ink">{formatINR(r.amountInr)}</span>
              <span className="text-right text-brand-ink">{r.status}</span>
            </div>
            {r.reference && (
              <p className="mt-0.5 text-xs text-brand-ink-soft break-all">
                Reference <span className="font-mono">{r.reference}</span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function NoAccess({ number }: { number: string }) {
  const valid = /^T-[A-Z0-9]{6}$/.test(number);
  return (
    <SupportShell crumbs={[{ label: "Tickets", href: "/support/tickets" }, { label: valid ? number : "Ticket" }]}>
      <section className="max-w-xl mx-auto px-4 py-10 sm:py-14 space-y-5">
        <div className={`${cardClass} bg-brand-cream`}>
          <div className="flex items-start gap-3">
            <Lock size={22} aria-hidden className="mt-0.5 shrink-0 text-brand-red" />
            <div className="min-w-0">
              <h1 className="font-display text-xl sm:text-2xl font-bold text-brand-ink">Verify to view this ticket</h1>
              <p className="mt-2 text-sm text-brand-ink-soft leading-relaxed">
                Tickets are private. Open the link from the email we sent when the request was raised, or verify the
                order it&apos;s about.
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-col gap-3">
            <Link href="/support/order" className={btnPrimary}>
              Verify my order
            </Link>
          </div>
        </div>

        <form action="/support/tickets" method="get" className={cardClass}>
          <label htmlFor="noaccess-lookup" className="flex items-center gap-2 font-display text-lg font-bold text-brand-ink">
            <MessageSquareWarning size={18} aria-hidden className="text-brand-red" />
            Try another ticket number
          </label>
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <input
              id="noaccess-lookup"
              name="number"
              type="text"
              required
              maxLength={12}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="T-7KQ2M9"
              className={`${inputClass} min-w-0 flex-1 font-mono uppercase`}
            />
            <button type="submit" className={`${btnDark} shrink-0`}>
              Check status
            </button>
          </div>
        </form>

        <p className="text-center text-sm text-brand-ink-soft">
          Lost the email? WhatsApp us ({SUPPORT_HOURS}) with the ticket number.
        </p>
      </section>
    </SupportShell>
  );
}
