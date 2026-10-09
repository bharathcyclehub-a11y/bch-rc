import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BadgeCheck,
  ChevronRight,
  Clock,
  CreditCard,
  Headset,
  RefreshCw,
  Search,
  Ticket,
  Truck,
  Wrench,
} from "lucide-react";
import { Skeleton } from "@/components/Skeleton";
import { getSupportSession, maskEmail } from "@/lib/support/session";
import { ARTICLE_CATEGORIES, listArticles } from "@/lib/support/kb";
import { loadPolicy } from "@/lib/support/config";
import { DEFAULT_POLICY } from "@/lib/support/rules";
import SupportShell from "./_components/SupportShell";
import { Eyebrow, REPLY_PROMISE, SUPPORT_HOURS, WhatsAppButton, btnDark, btnOutline, inputClass } from "./_components/ui";

export const metadata: Metadata = {
  title: { absolute: "PRC Support Centre — Pocket RC Cars" },
  description:
    "Track your order, get help with charging or the remote, raise a return or replacement, or talk to the Pocket RC Cars support team.",
  alternates: { canonical: "/support" },
};

type Service = {
  title: string;
  href: string;
  blurb: string;
  bullets: string[];
  icon: typeof Truck;
};

function services(windowDays: number): Service[] {
  return [
    {
      title: "Track my order",
      href: "/support/track",
      blurb: "Courier status and delivery date",
      bullets: ["Current status and courier updates", "Courier name and AWB number", "Estimated delivery date"],
      icon: Truck,
    },
    {
      title: "Return / Replace",
      href: "/support/order?next=claim",
      blurb: "Damaged, wrong or not working",
      bullets: [`Check the ${windowDays}-day replacement window`, "Add photos or a short video", "Follow your claim"],
      icon: RefreshCw,
    },
    {
      title: "Technical help",
      href: "/support/help?category=TROUBLESHOOTING",
      blurb: "Charging, remote pairing, steering",
      bullets: ["Battery and charging", "Pairing the remote", "Car not moving or steering"],
      icon: Wrench,
    },
    {
      title: "Payment / Refund",
      href: "/support/order?next=refund",
      blurb: "Payment status and refund updates",
      bullets: ["Payment status of your order", "Failed or double payment", "Refund progress and reference"],
      icon: CreditCard,
    },
    {
      title: "Delivery problem",
      href: "/support/order?next=delivery",
      blurb: "Delayed, not received, wrong status",
      bullets: ["Delivery taking too long", "Marked delivered but not received", "Tracking that looks wrong"],
      icon: AlertTriangle,
    },
    {
      title: "Talk to support",
      href: "/support/chat",
      blurb: "Support menu, WhatsApp or a ticket",
      bullets: ["Automated support menu", "WhatsApp our team", "Raise or follow a ticket"],
      icon: Headset,
    },
  ];
}

const QUICK_SEARCHES = [
  { label: "Track order", href: "/support/track" },
  { label: "Car not moving", href: "/support/help?q=moving" },
  { label: "Remote pairing", href: "/support/help?q=remote" },
  { label: "Refund status", href: "/support/order?next=refund" },
];

export default async function SupportHomePage() {
  const [session, policy] = await Promise.all([
    getSupportSession(),
    loadPolicy().catch(() => DEFAULT_POLICY),
  ]);

  return (
    <SupportShell>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="border-b border-brand-line bg-brand-cream">
        <div className="max-w-6xl mx-auto px-4 py-8 sm:py-12 lg:py-14">
          <Eyebrow>Help &amp; support</Eyebrow>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl lg:text-5xl font-bold text-brand-ink text-balance">
            PRC Support Centre
          </h1>

          <form action="/support/help" method="get" role="search" className="mt-5 max-w-2xl">
            <label htmlFor="support-search" className="block text-base sm:text-lg font-semibold text-brand-ink">
              How can we help you?
            </label>
            <div className="mt-2 flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  size={18}
                  aria-hidden
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-brand-ink-soft"
                />
                <input
                  id="support-search"
                  name="q"
                  type="search"
                  maxLength={80}
                  enterKeyHint="search"
                  placeholder="Search help: charging, remote, refund…"
                  className={`${inputClass} pl-11`}
                />
              </div>
              <button type="submit" className={`${btnDark} shrink-0`}>
                Search
              </button>
            </div>
          </form>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-brand-ink-soft">Frequent:</span>
            {QUICK_SEARCHES.map((q) => (
              <Link
                key={q.label}
                href={q.href}
                className="inline-flex min-h-12 sm:min-h-10 items-center rounded-full border border-brand-line bg-white px-4 text-sm font-medium text-brand-ink hover:border-brand-ink"
              >
                {q.label}
              </Link>
            ))}
          </div>

          {session && (
            <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 rounded-xl border border-tone-pos/30 bg-white p-3 sm:p-4 text-sm">
              <p className="flex items-start gap-2 text-brand-ink min-w-0">
                <BadgeCheck size={18} aria-hidden className="mt-0.5 shrink-0 text-tone-pos" />
                <span className="min-w-0 break-words">
                  You&apos;re verified as <span className="font-semibold">{maskEmail(session.email)}</span>
                </span>
              </p>
              <div className="flex flex-wrap gap-x-4 sm:ml-auto">
                <Link
                  href={`/support/order/${session.orderId}`}
                  className="inline-flex min-h-12 items-center font-semibold text-brand-ink underline underline-offset-4 hover:text-brand-red"
                >
                  View order {session.orderId}
                </Link>
                <Link
                  href="/support/tickets"
                  className="inline-flex min-h-12 items-center font-semibold text-brand-ink underline underline-offset-4 hover:text-brand-red"
                >
                  My tickets
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Six service cards ────────────────────────────────────────── */}
      <section aria-labelledby="services-heading" className="max-w-6xl mx-auto px-4 py-8 sm:py-10">
        <h2 id="services-heading" className="sr-only">
          What do you need help with?
        </h2>
        <ul className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {services(policy.replacementWindowDays).map((s) => {
            const Icon = s.icon;
            return (
              <li key={s.title} className="min-w-0">
                <Link
                  href={s.href}
                  className="group flex h-full min-h-36 flex-col rounded-2xl border border-brand-line bg-white p-4 sm:p-5 transition-colors hover:border-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red"
                >
                  <span
                    aria-hidden
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-red-soft text-brand-red"
                  >
                    <Icon size={22} />
                  </span>
                  <h3 className="mt-3 font-display text-base sm:text-lg font-bold leading-tight text-brand-ink break-words">
                    {s.title}
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm leading-snug text-brand-ink-soft lg:hidden">{s.blurb}</p>
                  <ul className="mt-3 hidden space-y-1.5 text-sm text-brand-ink-soft lg:block">
                    {s.bullets.map((b) => (
                      <li key={b} className="flex gap-2">
                        <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand-red" />
                        {b}
                      </li>
                    ))}
                  </ul>
                  <span
                    aria-hidden
                    className="mt-auto hidden pt-4 text-sm font-semibold text-brand-red group-hover:underline lg:block"
                  >
                    Open →
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Popular help + ticket lookup / person ───────────────────── */}
      <section className="max-w-6xl mx-auto px-4 pb-12 grid gap-6 lg:grid-cols-5 lg:gap-8">
        <div className="lg:col-span-3 min-w-0">
          <div className="flex items-end justify-between gap-3">
            <div>
              <Eyebrow>Help guides</Eyebrow>
              <h2 className="mt-1 font-display text-xl sm:text-2xl font-bold text-brand-ink">Popular help</h2>
            </div>
            <Link
              href="/support/help"
              className="inline-flex min-h-12 items-center text-sm font-semibold text-brand-ink underline underline-offset-4 hover:text-brand-red"
            >
              View all
            </Link>
          </div>
          <Suspense fallback={<PopularHelpSkeleton />}>
            <PopularHelp />
          </Suspense>
        </div>

        <div className="lg:col-span-2 space-y-4 min-w-0">
          <div className="rounded-2xl border border-brand-line bg-brand-cream p-4 sm:p-6">
            <div className="flex items-center gap-2">
              <Ticket size={20} aria-hidden className="text-brand-red" />
              <h2 className="font-display text-lg font-bold text-brand-ink">Have a ticket already?</h2>
            </div>
            <p className="mt-1 text-sm text-brand-ink-soft">Check progress or add more information.</p>
            <form action="/support/tickets" method="get" className="mt-4 flex flex-col sm:flex-row lg:flex-col xl:flex-row gap-2">
              <label htmlFor="home-ticket-number" className="sr-only">
                Ticket number
              </label>
              <input
                id="home-ticket-number"
                name="number"
                type="text"
                required
                maxLength={12}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                placeholder="Ticket number, e.g. T-7KQ2M9"
                className={`${inputClass} min-w-0 flex-1 font-mono uppercase`}
              />
              <button type="submit" className={`${btnDark} shrink-0`}>
                Check status
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-brand-line bg-white p-4 sm:p-6">
            <div className="flex items-center gap-2">
              <Headset size={20} aria-hidden className="text-brand-red" />
              <h2 className="font-display text-lg font-bold text-brand-ink">Need a person?</h2>
            </div>
            <p className="mt-2 flex items-start gap-2 text-sm text-brand-ink">
              <Clock size={16} aria-hidden className="mt-0.5 shrink-0 text-brand-ink-soft" />
              <span>
                Support hours {SUPPORT_HOURS} · {REPLY_PROMISE}
              </span>
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <WhatsAppButton message="Hi, I need help with my Pocket RC Cars order." label="WhatsApp us" />
              <Link href="/support/new" className={btnOutline}>
                Raise a ticket
              </Link>
            </div>
          </div>
        </div>
      </section>
    </SupportShell>
  );
}

async function PopularHelp() {
  const rows = await listArticles().catch(() => null);
  if (!rows) {
    return (
      <p className="mt-4 rounded-xl border border-brand-line p-4 text-sm text-brand-ink-soft">
        Help guides can&apos;t be loaded right now.{" "}
        <Link href="/support/chat" className="font-semibold text-brand-ink underline underline-offset-4">
          Try the support menu
        </Link>{" "}
        instead.
      </p>
    );
  }
  const top = [...rows].sort((a, b) => b.helpfulYes - a.helpfulYes).slice(0, 5);
  if (!top.length) {
    return (
      <p className="mt-4 rounded-xl border border-brand-line p-4 text-sm text-brand-ink-soft">
        Help guides are on their way. Meanwhile, WhatsApp us or raise a ticket and we&apos;ll help directly.
      </p>
    );
  }
  return (
    <ul className="mt-4 divide-y divide-brand-line rounded-2xl border border-brand-line">
      {top.map((a) => (
        <li key={a.slug}>
          <Link
            href={`/support/help/${a.slug}`}
            className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-brand-cream focus-visible:outline-2 focus-visible:outline-brand-red"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-mono font-bold uppercase tracking-widest text-brand-ink-soft">
                {ARTICLE_CATEGORIES[a.category as keyof typeof ARTICLE_CATEGORIES] ?? "Help"}
              </span>
              <span className="block font-semibold text-brand-ink break-words">{a.title}</span>
            </span>
            <ChevronRight size={18} aria-hidden className="shrink-0 text-brand-ink-soft" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function PopularHelpSkeleton() {
  return (
    <div className="mt-4 divide-y divide-brand-line rounded-2xl border border-brand-line" aria-busy="true">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="space-y-2 px-4 py-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}
