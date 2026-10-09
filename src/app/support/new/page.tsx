import type { Metadata } from "next";
import { getSupportSession, maskEmail } from "@/lib/support/session";
import { ORDER_ID_RE, normaliseOrderId } from "@/lib/support/verify";
import { getOwnedOrder, itemValue, listCustomerOrders, orderItems } from "@/lib/support/customer-queries";
import { loadPolicy } from "@/lib/support/config";
import { EVIDENCE_ACCEPT, MAX_EVIDENCE_BYTES, MAX_EVIDENCE_FILES } from "@/lib/support/evidence";
import { DEFAULT_POLICY, isCategory } from "@/lib/support/rules";
import SupportShell from "../_components/SupportShell";
import { Eyebrow } from "../_components/ui";
import TicketForm, { type FormOrder, type GroupKey } from "./TicketForm";

export const metadata: Metadata = {
  title: { absolute: "Raise a request — PRC Support" },
  description: "Tell the Pocket RC Cars team what went wrong. Add photos, and follow the reply on your ticket page.",
  robots: { index: false },
};

type SP = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const GROUPS: GroupKey[] = ["DELIVERY", "PRODUCT", "RETURNS", "MONEY", "OTHER"];

export default async function NewTicketPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const rawCategory = first(sp.category);
  const category = isCategory(rawCategory) ? rawCategory : null;
  const rawGroup = first(sp.group) as GroupKey;
  const group = GROUPS.includes(rawGroup) ? rawGroup : null;
  const rawOrder = normaliseOrderId(first(sp.order).slice(0, 20));
  const orderParam = ORDER_ID_RE.test(rawOrder) ? rawOrder : null;
  const item = first(sp.item).slice(0, 200) || null;

  const session = await getSupportSession();
  const [order, customerOrders, policy] = await Promise.all([
    session && orderParam ? getOwnedOrder(orderParam, session.customerId) : Promise.resolve(null),
    session ? listCustomerOrders(session.customerId, 10) : Promise.resolve([]),
    loadPolicy().catch(() => DEFAULT_POLICY),
  ]);

  let formOrder: FormOrder | null = null;
  if (order) {
    // One picker entry per product + colour.
    const merged = new Map<string, FormOrder["items"][number]>();
    for (const it of orderItems(order)) {
      const value = itemValue(it);
      const prev = merged.get(value);
      if (prev) prev.qty += it.qty;
      else merged.set(value, { value, name: it.name, variantName: it.variantName, image: it.image, qty: it.qty });
    }
    formOrder = {
      id: order.id,
      status: order.status,
      placedAt: order.placedAt.toISOString(),
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      items: [...merged.values()],
    };
  }

  return (
    <SupportShell crumbs={[{ label: "Raise a request" }]}>
      <section className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
        <Eyebrow>PRC Support · New request</Eyebrow>
        <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold text-brand-ink text-balance">
          Tell us what happened
        </h1>
        <p className="mt-3 text-base text-brand-ink-soft leading-relaxed">
          One request covers everything — our team replies on your ticket page and by email.
        </p>

        <TicketForm
          order={formOrder}
          requestedOrderId={orderParam}
          verifiedEmail={session ? maskEmail(session.email) : null}
          customerOrders={customerOrders.map((o) => ({
            id: o.id,
            label: `${o.id} · ${o.statusLabel}${o.firstItemName ? ` · ${o.firstItemName}` : ""}`,
          }))}
          policy={policy}
          accept={EVIDENCE_ACCEPT}
          maxFiles={Math.min(policy.maxEvidenceFiles, MAX_EVIDENCE_FILES)}
          maxMb={Math.min(policy.maxEvidenceMb, MAX_EVIDENCE_BYTES / (1024 * 1024))}
          initialCategory={category}
          initialGroup={group}
          initialItem={item}
          nowIso={new Date().toISOString()}
        />
      </section>
    </SupportShell>
  );
}
