import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight, MapPin, MessageCircle, Phone, Receipt } from "lucide-react";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { addresses, customers, orders } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { PAID_STATUSES, VALID_ORDER_STATUSES } from "@/lib/order-status";
import { customerSegmentOf, PAYMENT_METHOD_LABEL } from "@/lib/admin/status";
import {
  formatDateShort,
  formatDateTimeShort,
  formatMonthYear,
  formatPhone,
  formatRelative,
  mobile10,
  plural,
  requestTime,
} from "@/lib/admin/format";
import { cn, formatINR } from "@/lib/utils";
import { Avatar } from "@/components/admin/Avatar";
import { OrderStatusBadge, SegmentBadge, Tag } from "@/components/admin/Badge";
import { buttonClass } from "@/components/admin/Button";
import { EmptyState } from "@/components/admin/EmptyState";
import { Metric } from "@/components/admin/Metric";
import { PageHeader } from "@/components/admin/PageHeader";
import { KeyValue, Panel, PanelHeader } from "@/components/admin/Panel";
import { RowLink, Table, TBody, TD, TH, THead, TR } from "@/components/admin/Table";
import { CustomerEditForm } from "./CustomerEditForm";

type ShippingAddr = {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
};

/** Address enriched with saved-address-book metadata for display. */
type DisplayAddr = ShippingAddr & {
  saved?: boolean;
  isDefault?: boolean;
  label?: string | null;
};

type OrderRow = typeof orders.$inferSelect;

const VALID = new Set<string>(VALID_ORDER_STATUSES);
const PAID = new Set<string>(PAID_STATUSES);

function addrKey(a: ShippingAddr): string {
  return [a.line1, a.line2, a.city, a.state, a.pincode]
    .filter(Boolean)
    .map((s) => s!.trim().toLowerCase())
    .join("|");
}

function addrLines(a: ShippingAddr): string[] {
  return [
    a.line1,
    a.line2,
    [a.city, a.state, a.pincode].filter(Boolean).join(", "),
  ].filter((s): s is string => Boolean(s && s.trim()));
}


export default async function AdminCustomerDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireAdmin();
  const { id } = await params;

  // Customers (and their address book) are global by phone, so no site filter
  // on those; orders are site-scoped — only the ones this operator may view.
  const [[customer], customerOrders, savedAddrs] = await Promise.all([
    db.select().from(customers).where(eq(customers.id, id)),
    db
      .select()
      .from(orders)
      .where(and(eq(orders.customerId, id), inArray(orders.siteId, ctx.siteIds)))
      .orderBy(desc(orders.placedAt)),
    // Default first, then most-recent.
    db
      .select()
      .from(addresses)
      .where(eq(addresses.customerId, id))
      .orderBy(desc(addresses.isDefault), desc(addresses.createdAt)),
  ]);

  if (!customer) notFound();

  // Derived stats from the orders this admin can see (not the denormalised
  // counters on the customer row, which span sites the admin can't). Same
  // definitions as the customers list: orders = real placed orders
  // (VALID_ORDER_STATUSES), lifetime value = paid orders only.
  const validOrders = customerOrders.filter((o) => VALID.has(o.status));
  const paidOrders = customerOrders.filter((o) => PAID.has(o.status));
  const ltv = paidOrders.reduce((sum, o) => sum + o.totalInr, 0);
  const aov = paidOrders.length > 0 ? Math.round(ltv / paidOrders.length) : null;
  const lastOrder = validOrders[0] ?? null;
  const firstOrder = validOrders[validOrders.length - 1] ?? null;
  const notCounted = customerOrders.length - validOrders.length;
  const now = requestTime();
  const segment = customerSegmentOf(validOrders.length, lastOrder?.placedAt ?? null, now);

  // Merge: prefer the real address book, then fold in any distinct addresses
  // seen only inside order snapshots. Dedupe on the normalised address key and
  // keep insert order so saved (and the default) show first.
  const addrSeen = new Set<string>();
  const uniqueAddrs: DisplayAddr[] = [];
  for (const a of savedAddrs) {
    const disp: DisplayAddr = {
      fullName: a.fullName,
      phone: a.phone,
      line1: a.line1,
      line2: a.line2 ?? undefined,
      city: a.city,
      state: a.state,
      pincode: a.pincode,
      saved: true,
      isDefault: a.isDefault,
      label: a.label,
    };
    const key = addrKey(disp);
    if (!key || addrSeen.has(key)) continue;
    addrSeen.add(key);
    uniqueAddrs.push(disp);
  }
  for (const o of customerOrders) {
    const a = o.shippingAddress as ShippingAddr;
    const key = addrKey(a);
    if (!key || addrSeen.has(key)) continue;
    addrSeen.add(key);
    uniqueAddrs.push(a);
  }

  const name = customer.name?.trim() || null;
  const ten = mobile10(customer.phone);

  return (
    <>
      <PageHeader
        back={{ href: "/admin/customers", label: "Customers" }}
        media={<Avatar name={name} className="h-12 w-12 text-sm" />}
        title={name ?? "Anonymous customer"}
        badges={<SegmentBadge segment={segment} />}
        description={`Customer since ${formatMonthYear(customer.createdAt)}`}
        actions={
          ten && (
            <>
              <a
                href={`https://wa.me/91${ten}`}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ className: "max-sm:w-11 max-sm:px-0" })}
              >
                <MessageCircle size={15} aria-hidden />
                <span className="max-sm:sr-only">WhatsApp</span>
              </a>
              <a href={`tel:+91${ten}`} className={buttonClass({ className: "max-sm:w-11 max-sm:px-0" })}>
                <Phone size={15} aria-hidden />
                <span className="max-sm:sr-only">Call</span>
              </a>
            </>
          )
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:mb-6 md:grid-cols-4">
        <Metric
          label="Orders"
          value={validOrders.length.toLocaleString("en-IN")}
          hint={firstOrder ? `First ${formatDateShort(firstOrder.placedAt, now)}` : "No orders yet"}
        />
        <Metric label="Lifetime value" value={formatINR(ltv)} hint="Paid orders only" />
        <Metric
          label="Avg order"
          value={aov === null ? "—" : formatINR(aov)}
          hint={paidOrders.length > 0 ? plural(paidOrders.length, "paid order") : "No paid orders"}
        />
        <Metric
          label="Last order"
          value={lastOrder ? formatRelative(lastOrder.placedAt, now) : "—"}
          hint={lastOrder ? formatDateTimeShort(lastOrder.placedAt) : undefined}
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3 lg:gap-6">
        <div className="min-w-0 lg:col-span-2">
          <Panel>
            <PanelHeader
              title="Order history"
              description={
                customerOrders.length === 0
                  ? undefined
                  : notCounted > 0
                    ? `${plural(customerOrders.length, "order")} · ${notCounted.toLocaleString("en-IN")} failed, cancelled or abandoned (not counted)`
                    : plural(customerOrders.length, "order")
              }
            />
            {customerOrders.length === 0 ? (
              <EmptyState
                compact
                icon={Receipt}
                title="No orders yet"
                description="Orders this customer places on your sites will appear here."
              />
            ) : (
              <>
                <OrdersTable rows={customerOrders} />
                <OrderRows rows={customerOrders} />
              </>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">
          <Panel>
            <PanelHeader title="Contact" />
            <KeyValue
              items={[
                {
                  label: "Phone",
                  value: ten ? (
                    <a href={`tel:+91${ten}`} className="whitespace-nowrap font-mono hover:underline">
                      +91 {formatPhone(ten)}
                    </a>
                  ) : (
                    <span className="whitespace-nowrap font-mono">{customer.phone}</span>
                  ),
                },
                {
                  label: "Email",
                  value: customer.email ? (
                    <a href={`mailto:${customer.email}`} className="break-all hover:underline">
                      {customer.email}
                    </a>
                  ) : (
                    <span className="font-normal text-admin-muted">Not on file</span>
                  ),
                },
              ]}
            />
          </Panel>

          {/* Editable CRM details (name, email, notes) */}
          <CustomerEditForm
            id={customer.id}
            initialName={customer.name}
            initialEmail={customer.email}
            initialNotes={customer.notes}
          />

          {/* Saved address book merged with distinct order snapshots */}
          <Panel>
            <PanelHeader
              title="Addresses"
              description={
                uniqueAddrs.length > 0 ? plural(uniqueAddrs.length, "unique address", "unique addresses") : undefined
              }
            />
            {uniqueAddrs.length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-admin-muted sm:px-5">No addresses on file yet.</p>
            ) : (
              <ul className="divide-y divide-admin-line">
                {uniqueAddrs.map((a, i) => (
                  <li key={`${addrKey(a)}-${i}`} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                    <MapPin size={15} aria-hidden className="mt-0.5 shrink-0 text-admin-muted" />
                    <div className="min-w-0 flex-1 text-[13px] leading-5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {a.fullName && <span className="font-semibold text-brand-ink">{a.fullName}</span>}
                        {a.isDefault && <Tag>Default</Tag>}
                        {a.saved ? (
                          <Tag>{a.label?.trim() || "Saved"}</Tag>
                        ) : (
                          <span className="text-xs text-admin-muted">From order</span>
                        )}
                      </div>
                      {addrLines(a).map((line, idx) => (
                        <p key={idx} className="break-words text-brand-ink-soft">
                          {line}
                        </p>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

// Compact cells so the table fits the 2/3 column at 1024px; outer cells keep the 16px inset.
const CELL = "px-3 first:pl-4 last:pr-4";

function OrdersTable({ rows }: { rows: OrderRow[] }) {
  return (
    <Table className="hidden md:block">
      <THead>
        <TH className={CELL}>Order</TH>
        <TH className={CELL}>Date</TH>
        <TH className={cn(CELL, "hidden md:table-cell lg:hidden xl:table-cell")}>Payment</TH>
        <TH className={CELL}>Status</TH>
        <TH align="right" className={CELL}>
          Amount
        </TH>
      </THead>
      <TBody>
        {rows.map((o) => (
          <TR key={o.id}>
            <TD nowrap className={CELL}>
              <RowLink href={`/admin/orders/${o.id}`} className="font-mono">
                {o.id}
              </RowLink>
            </TD>
            <TD nowrap className={cn(CELL, "text-brand-ink-soft")}>
              {formatDateTimeShort(o.placedAt)}
            </TD>
            <TD nowrap className={cn(CELL, "hidden text-brand-ink-soft md:table-cell lg:hidden xl:table-cell")}>
              {PAYMENT_METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod}
            </TD>
            <TD nowrap className={CELL}>
              <OrderStatusBadge status={o.status} />
            </TD>
            <TD
              align="right"
              nowrap
              className={cn(CELL, VALID.has(o.status) ? "font-semibold" : "text-admin-muted")}
            >
              {formatINR(o.totalInr)}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/** Phones: order ID + amount, then status + date. The whole row opens the order. */
function OrderRows({ rows }: { rows: OrderRow[] }) {
  return (
    <ul className="divide-y divide-admin-line md:hidden">
      {rows.map((o) => (
        <li key={o.id}>
          <Link
            href={`/admin/orders/${o.id}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors active:bg-admin-subtle"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-3">
                <p className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold text-brand-ink">{o.id}</p>
                <p
                  className={cn(
                    "shrink-0 whitespace-nowrap text-sm tabular-nums",
                    VALID.has(o.status) ? "font-semibold text-brand-ink" : "text-admin-muted",
                  )}
                >
                  {formatINR(o.totalInr)}
                </p>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <OrderStatusBadge status={o.status} />
                <span className="min-w-0 truncate text-xs text-admin-muted">
                  {formatDateTimeShort(o.placedAt)} · {PAYMENT_METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod}
                </span>
              </div>
            </div>
            <ChevronRight size={16} aria-hidden className="shrink-0 text-admin-muted" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
