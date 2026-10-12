import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, BadgeCheck, LogOut, Truck } from "lucide-react";
import { getSupportSession, maskEmail } from "@/lib/support/session";
import { ORDER_ID_RE, normaliseOrderId } from "@/lib/support/verify";
import { getOwnedOrder } from "@/lib/support/customer-queries";
import SupportShell from "../_components/SupportShell";
import { Eyebrow, SUPPORT_HOURS, btnOutline, btnPrimary } from "../_components/ui";
import VerifyFlow from "./VerifyFlow";
import { signOutSupportAction, type VerifyNext } from "./actions";

export const metadata: Metadata = {
  title: { absolute: "Verify your order — PRC Support" },
  description: "Verify your Pocket RC Cars order with a one-time email code to see details and raise a request.",
  robots: { index: false },
};

type SP = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const HEADINGS: Record<VerifyNext, { eyebrow: string; title: string }> = {
  "": { eyebrow: "Self-service", title: "Look up your order" },
  claim: { eyebrow: "Return / replace", title: "Verify your order to start a claim" },
  refund: { eyebrow: "Payment / refund", title: "Verify your order to see payment details" },
  delivery: { eyebrow: "Delivery problem", title: "Verify your order to report a problem" },
};

export default async function SupportOrderLookupPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const rawId = normaliseOrderId(first(sp.id).slice(0, 20));
  const orderId = ORDER_ID_RE.test(rawId) ? rawId : "";
  const n = first(sp.next);
  const next: VerifyNext = n === "claim" || n === "refund" || n === "delivery" ? n : "";
  const session = await getSupportSession();

  // Which order the current session may open: the requested one if it is the
  // customer's own, otherwise the one they verified with.
  let viewable: string | null = null;
  let otherOrderRequested = false;
  if (session) {
    if (!orderId || orderId === session.orderId) viewable = session.orderId;
    else if (await getOwnedOrder(orderId, session.customerId)) viewable = orderId;
    else otherOrderRequested = true;
  }
  const head = HEADINGS[next];
  const nextQs = next ? `?next=${next}#get-help` : "";

  return (
    <SupportShell crumbs={[{ label: "Find order" }]}>
      <section className="max-w-xl mx-auto px-4 py-8 sm:py-12">
        <Eyebrow>{head.eyebrow}</Eyebrow>
        <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold text-brand-ink text-balance">{head.title}</h1>
        <p className="mt-3 text-base text-brand-ink-soft leading-relaxed">
          Verify your contact details to see full order details, raise a return or replacement and follow your
          requests.
        </p>

        {session && viewable && (
          <div className="mt-6 rounded-2xl border border-tone-pos/30 bg-tone-pos-bg p-4 sm:p-5">
            <p className="flex items-start gap-2 text-sm text-brand-ink">
              <BadgeCheck size={20} aria-hidden className="mt-0.5 shrink-0 text-tone-pos" />
              <span className="min-w-0 break-words">
                You&apos;re verified as <strong className="font-semibold">{maskEmail(session.email)}</strong>.
              </span>
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-3">
              <Link href={`/support/order/${viewable}${nextQs}`} className={`${btnPrimary} flex-1`}>
                View order {viewable}
              </Link>
              <form action={signOutSupportAction}>
                <button type="submit" className={`${btnOutline} w-full`}>
                  <LogOut size={16} aria-hidden />
                  Sign out
                </button>
              </form>
            </div>
            <p className="mt-3 text-xs text-brand-ink-soft">Need a different order? Verify it below.</p>
          </div>
        )}

        {session && otherOrderRequested && (
          <p className="mt-6 rounded-xl border border-brand-line bg-brand-cream p-4 text-sm text-brand-ink">
            You&apos;re verified for a different order. To open {orderId}, verify it below with the details used for
            that order.
          </p>
        )}

        <VerifyFlow initialOrderId={orderId} next={next} />

        <section className="mt-6 rounded-2xl border border-brand-line bg-brand-cream p-4 sm:p-6">
          <div className="flex items-start gap-3">
            <Truck size={22} aria-hidden className="mt-0.5 shrink-0 text-brand-red" />
            <div className="min-w-0">
              <h2 className="font-display text-lg font-bold text-brand-ink">Only want delivery status?</h2>
              <p className="mt-1 text-sm text-brand-ink-soft">
                You don&apos;t need a code just to check courier tracking.
              </p>
            </div>
          </div>
          <Link
            href={orderId ? `/support/track?id=${encodeURIComponent(orderId)}` : "/support/track"}
            className={`${btnOutline} mt-4 w-full`}
          >
            Track with order ID only
            <ArrowUpRight size={16} aria-hidden />
          </Link>
        </section>

        <p className="mt-6 text-center text-sm text-brand-ink-soft">
          Need help now?{" "}
          <Link href="/support/chat" className="font-semibold text-brand-ink underline underline-offset-4">
            Use the support menu
          </Link>{" "}
          or WhatsApp us ({SUPPORT_HOURS}).
        </p>
      </section>
    </SupportShell>
  );
}
