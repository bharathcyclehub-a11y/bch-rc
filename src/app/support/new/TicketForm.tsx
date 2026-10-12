"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, BadgeCheck, Lock, Package, Send } from "lucide-react";
import {
  CATEGORY_KEYS,
  TICKET_CATEGORIES,
  checkEligibility,
  isCategory,
  type SupportPolicy,
  type TicketCategory,
} from "@/lib/support/rules";
import EvidencePicker, { MAX_TOTAL_BYTES, TOTAL_TOO_BIG, totalBytes, type PickedFile } from "../_components/EvidencePicker";
import { Notice, REPLY_PROMISE, SUPPORT_HOURS, btnOutline, btnPrimary, inputClass } from "../_components/ui";
import { clearPrefill, parsePrefill, peekPrefill, type SupportPrefill } from "../_lib/prefill";
import { submitTicketAction } from "../tickets/actions";

export type GroupKey = "DELIVERY" | "PRODUCT" | "RETURNS" | "MONEY" | "OTHER";

export type FormOrder = {
  id: string;
  status: string;
  placedAt: string;
  deliveredAt: string | null;
  items: Array<{ value: string; name: string; variantName: string | null; image: string | null; qty: number }>;
};

const GROUP_LABEL: Record<GroupKey, string> = {
  DELIVERY: "Delivery",
  PRODUCT: "Problem with a product",
  RETURNS: "Return or replacement",
  MONEY: "Payment & refunds",
  OTHER: "Something else",
};
const GROUP_ORDER: GroupKey[] = ["DELIVERY", "PRODUCT", "RETURNS", "MONEY", "OTHER"];

/** Categories where the battery could be involved — ask the safety question. */
const SAFETY_CATEGORIES = new Set<TicketCategory>([
  "DAMAGED_PRODUCT",
  "PRODUCT_NOT_WORKING",
  "BATTERY_CHARGING",
  "REMOTE_CONNECTION",
  "REPLACEMENT_REQUEST",
]);

const PLACEHOLDER: Record<GroupKey, string> = {
  DELIVERY: "e.g. Tracking says delivered yesterday but the parcel hasn't reached me.",
  PRODUCT: "e.g. The car switches on but won't move forward. It started after the first charge.",
  RETURNS: "e.g. The car arrived with a cracked shell. I'd like a replacement.",
  MONEY: "e.g. Money was debited twice for this order.",
  OTHER: "Tell us what you need help with.",
};

const MIN_DESC = 10;
const MAX_DESC = 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const nextFor = (g: GroupKey) => (g === "DELIVERY" ? "delivery" : g === "MONEY" ? "refund" : "claim");

export default function TicketForm({
  order,
  requestedOrderId,
  verifiedEmail,
  customerOrders,
  policy,
  accept,
  maxFiles,
  maxMb,
  initialCategory,
  initialGroup,
  initialItem,
  nowIso,
}: {
  order: FormOrder | null;
  /** ?order= from the URL when it is NOT (yet) verified for this session. */
  requestedOrderId: string | null;
  verifiedEmail: string | null;
  customerOrders: Array<{ id: string; label: string }>;
  policy: SupportPolicy;
  accept: string;
  maxFiles: number;
  maxMb: number;
  initialCategory: TicketCategory | null;
  initialGroup: GroupKey | null;
  initialItem: string | null;
  nowIso: string;
}) {
  const router = useRouter();
  const [category, setCategory] = useState<TicketCategory | null>(initialCategory);
  const [item, setItem] = useState<string | null>(() => {
    if (!order) return null;
    if (initialItem && order.items.some((i) => i.value === initialItem)) return initialItem;
    return order.items.length === 1 ? order.items[0].value : null;
  });
  const [description, setDescription] = useState("");
  const [safety, setSafety] = useState(false);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [prefill, setPrefill] = useState<SupportPrefill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const errorRef = useRef<HTMLDivElement>(null);

  const cat = category ? TICKET_CATEGORIES[category] : null;
  const blocked = !!cat && cat.needsOrder && !order;

  // Hand-off from the support menu or a help guide (sessionStorage). Applied
  // after mount so server and client render the same first frame.
  useEffect(() => {
    const raw = peekPrefill();
    if (!raw) return;
    const frame = requestAnimationFrame(() => {
      const p = parsePrefill(raw);
      if (!p) {
        clearPrefill();
        return;
      }
      setPrefill(p);
      setDescription((d) => (d.trim() ? d : p.text.slice(0, MAX_DESC)));
      setCategory((c) => c ?? (p.category && isCategory(p.category) ? p.category : null));
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  // Keep it until the form is actually usable (verification may come first).
  useEffect(() => {
    if (prefill && cat && !blocked) clearPrefill();
  }, [prefill, cat, blocked]);

  const groups = (() => {
    const orderList = [...GROUP_ORDER];
    if (initialGroup) {
      const lead: GroupKey[] = initialGroup === "PRODUCT" ? ["PRODUCT", "RETURNS"] : [initialGroup];
      orderList.sort((a, b) => (lead.includes(b) ? 1 : 0) - (lead.includes(a) ? 1 : 0));
    }
    return orderList.map((g) => ({ g, keys: CATEGORY_KEYS.filter((k) => TICKET_CATEGORIES[k].group === g) }));
  })();

  const showItems = !!cat && !!order && (cat.group === "PRODUCT" || cat.group === "RETURNS") && order.items.length > 0;
  const showSafety = !!category && SAFETY_CATEGORIES.has(category);
  const eligibility =
    category && cat?.claimReason && order
      ? checkEligibility({
          category,
          orderStatus: order.status,
          deliveredAt: order.deliveredAt ? new Date(order.deliveredAt) : null,
          now: new Date(nowIso),
          policy,
        })
      : null;
  const descLen = description.trim().length;
  const contextJson = prefill?.context ? JSON.stringify({ source: prefill.source, ...prefill.context }) : "";

  function fail(message: string) {
    setError(message);
    requestAnimationFrame(() => errorRef.current?.focus());
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    if (!cat || !category) return fail("Choose what you need help with.");
    if (blocked) return fail("Please verify your order first.");
    if (showItems && !item) return fail("Choose which item has the problem.");
    if (descLen < MIN_DESC) return fail(`Please describe the problem in at least ${MIN_DESC} characters.`);
    if (cat.evidence === "REQUIRED" && files.length === 0) {
      return fail("Please add at least one photo or short video showing the problem.");
    }
    if (totalBytes(files) > MAX_TOTAL_BYTES) return fail(TOTAL_TOO_BIG);
    const fd = new FormData(e.currentTarget);
    if (!verifiedEmail) {
      const name = String(fd.get("name") ?? "").trim();
      const email = String(fd.get("email") ?? "").trim();
      if (name.length < 2) return fail("Enter your name.");
      if (!EMAIL_RE.test(email)) return fail("Enter a valid email address so we can reply.");
    }
    fd.delete("files");
    for (const f of files) fd.append("files", f.file, f.file.name);
    setError(null);
    startTransition(async () => {
      try {
        const res = await submitTicketAction(fd);
        if (res.ok && res.href) {
          clearPrefill();
          router.push(res.href);
        } else if (!res.ok) {
          fail(res.error);
        }
      } catch {
        fail(
          "We couldn't send your request — the attachments may be too large or the connection dropped. Try fewer or smaller files and submit again, or send videos on WhatsApp.",
        );
      }
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 space-y-6">
      {order && (
        <div className="flex items-center gap-3 rounded-2xl border border-brand-line bg-brand-cream p-4">
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-brand-line bg-white">
            {order.items[0]?.image ? (
              <Image src={order.items[0].image} alt="" fill sizes="56px" className="object-cover" />
            ) : (
              <Package size={22} aria-hidden className="absolute inset-0 m-auto text-brand-ink-soft" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-sm font-bold text-brand-ink break-all">{order.id}</p>
            <p className="text-xs text-brand-ink-soft">
              {order.deliveredAt ? `Delivered ${fmt(order.deliveredAt)}` : `Placed ${fmt(order.placedAt)}`}
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-tone-pos-bg px-2.5 py-1 text-xs font-semibold text-tone-pos">
            <BadgeCheck size={14} aria-hidden />
            Verified
          </span>
          <input type="hidden" name="orderId" value={order.id} />
        </div>
      )}

      {/* ── 1. Category ──────────────────────────────────────────────── */}
      <fieldset className="min-w-0">
        <legend className="font-display text-lg font-bold text-brand-ink">1. What do you need help with?</legend>
        <div className="mt-3 space-y-4">
          {groups.map(({ g, keys }) => (
            <div key={g}>
              <p className="text-[11px] font-mono font-bold uppercase tracking-widest text-brand-ink-soft">
                {GROUP_LABEL[g]}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {keys.map((k) => {
                  const checked = category === k;
                  return (
                    <label
                      key={k}
                      className={`inline-flex min-h-12 cursor-pointer items-center rounded-full border px-4 text-sm font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-red ${
                        checked
                          ? "border-brand-ink bg-brand-ink text-white"
                          : "border-brand-line bg-white text-brand-ink hover:border-brand-ink"
                      }`}
                    >
                      <input
                        type="radio"
                        name="category"
                        value={k}
                        checked={checked}
                        onChange={() => {
                          setCategory(k);
                          setError(null);
                        }}
                        className="sr-only"
                      />
                      {TICKET_CATEGORIES[k].label}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {cat && <p className="mt-3 text-sm text-brand-ink-soft">{cat.hint}</p>}
      </fieldset>

      {cat && blocked && (
        <VerifyFirst
          group={cat.group}
          category={category!}
          requestedOrderId={requestedOrderId}
          verifiedEmail={verifiedEmail}
          customerOrders={customerOrders}
          onGeneral={() => setCategory("GENERAL")}
        />
      )}

      {cat && !blocked && (
        <>
          {eligibility && (
            <Notice tone={eligibility.eligible ? "success" : "warn"} title={eligibility.message} role="status">
              {eligibility.conditions.length > 0 && (
                <ul className="list-disc pl-5">
                  {eligibility.conditions.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </Notice>
          )}

          {/* ── 2. Item ────────────────────────────────────────────────── */}
          {showItems && order && (
            <fieldset className="min-w-0">
              <legend className="font-display text-lg font-bold text-brand-ink">2. Which item has the problem?</legend>
              <div className="mt-3 space-y-2">
                {order.items.map((it) => {
                  const checked = item === it.value;
                  return (
                    <label
                      key={it.value}
                      className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-red ${
                        checked ? "border-brand-ink bg-brand-cream" : "border-brand-line bg-white hover:border-brand-ink"
                      }`}
                    >
                      <input
                        type="radio"
                        name="item"
                        value={it.value}
                        checked={checked}
                        onChange={() => setItem(it.value)}
                        className="h-5 w-5 shrink-0 accent-brand-red"
                      />
                      <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-brand-line bg-white">
                        {it.image ? (
                          <Image src={it.image} alt="" fill sizes="48px" className="object-cover" />
                        ) : (
                          <Package size={20} aria-hidden className="absolute inset-0 m-auto text-brand-ink-soft" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-brand-ink break-words">{it.name}</span>
                        <span className="block text-sm text-brand-ink-soft">
                          {[it.variantName, `Qty ${it.qty}`].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          {/* ── 3. Description ─────────────────────────────────────────── */}
          <div>
            <label htmlFor="ticket-description" className="font-display text-lg font-bold text-brand-ink">
              {showItems ? "3." : "2."} Tell us what happened
            </label>
            {prefill && (
              <p className="mt-1 text-sm text-tone-pos">
                {prefill.source === "guide"
                  ? "We've added the guide steps you tried, so you don't have to repeat them."
                  : "We've copied your chat into this request, so you don't have to repeat yourself."}
              </p>
            )}
            <textarea
              id="ticket-description"
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={MAX_DESC}
              placeholder={PLACEHOLDER[cat.group]}
              aria-describedby="ticket-description-count"
              className={`${inputClass} mt-2 resize-y leading-relaxed`}
            />
            <p id="ticket-description-count" className="mt-1 flex justify-between gap-3 text-xs text-brand-ink-soft">
              <span>Minimum {MIN_DESC} characters</span>
              <span aria-live="off" className={descLen > 0 && descLen < MIN_DESC ? "text-brand-red" : undefined}>
                {description.length} / {MAX_DESC}
              </span>
            </p>
          </div>

          {showSafety && (
            <div className="rounded-2xl border border-tone-warn/30 bg-tone-warn-bg p-4">
              <label className="flex min-h-12 cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  name="safety"
                  value="1"
                  checked={safety}
                  onChange={(e) => setSafety(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-brand-red"
                />
                <span className="text-sm text-brand-ink">
                  <span className="block font-semibold">Is there heat, smoke, swelling or a burning smell?</span>
                  <span className="block text-brand-ink-soft">
                    Tick if yes. Unplug it, stop using it and keep it away from anything flammable — we&apos;ll treat
                    it as urgent.
                  </span>
                </span>
              </label>
            </div>
          )}

          {/* ── Evidence ───────────────────────────────────────────────── */}
          <EvidencePicker
            files={files}
            onChange={setFiles}
            accept={accept}
            maxFiles={maxFiles}
            maxMb={maxMb}
            rule={cat.evidence}
            disabled={pending}
            hint={
              cat.evidence === "REQUIRED"
                ? "Show the problem clearly. For damage, include the box and shipping label if you still have them."
                : cat.evidence === "RECOMMENDED"
                  ? "A photo or short video helps us sort it out faster."
                  : undefined
            }
          />

          {/* ── Contact ────────────────────────────────────────────────── */}
          {verifiedEmail ? (
            <p className="flex items-start gap-2 text-sm text-brand-ink-soft">
              <Lock size={16} aria-hidden className="mt-0.5 shrink-0" />
              <span>
                We&apos;ll reply to <span className="font-semibold text-brand-ink">{verifiedEmail}</span>
                {order ? " and the phone number on this order." : "."}
              </span>
            </p>
          ) : (
            <fieldset className="min-w-0 space-y-4">
              <legend className="font-display text-lg font-bold text-brand-ink">How can we reach you?</legend>
              <div>
                <label htmlFor="ticket-name" className="block text-sm font-semibold text-brand-ink">
                  Your name
                </label>
                <input id="ticket-name" name="name" type="text" autoComplete="name" maxLength={80} className={`${inputClass} mt-1.5`} />
              </div>
              <div>
                <label htmlFor="ticket-email" className="block text-sm font-semibold text-brand-ink">
                  Email
                </label>
                <input
                  id="ticket-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  maxLength={160}
                  aria-describedby="ticket-email-hint"
                  className={`${inputClass} mt-1.5`}
                />
                <p id="ticket-email-hint" className="mt-1 text-xs text-brand-ink-soft">
                  We email you a private link to follow this request.
                </p>
              </div>
              <div>
                <label htmlFor="ticket-phone" className="block text-sm font-semibold text-brand-ink">
                  Phone <span className="font-normal text-brand-ink-soft">(optional)</span>
                </label>
                <input
                  id="ticket-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={20}
                  className={`${inputClass} mt-1.5`}
                />
              </div>
            </fieldset>
          )}

          {cat.claimReason && policy.notCovered.length > 0 && (
            <details className="rounded-xl border border-brand-line p-4 text-sm">
              <summary className="min-h-6 cursor-pointer font-semibold text-brand-ink">What isn&apos;t covered</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-brand-ink-soft">
                {policy.notCovered.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <Link href="/policies/replacement" className="mt-2 inline-flex min-h-12 items-center font-semibold text-brand-ink underline underline-offset-4">
                Read the replacement policy
              </Link>
            </details>
          )}

          <input type="hidden" name="context" value={contextJson} />

          {error && (
            <div ref={errorRef} tabIndex={-1} role="alert" className="flex items-start gap-2 rounded-xl border border-tone-neg/30 bg-tone-neg-bg p-3 text-sm font-medium text-tone-neg outline-none">
              <AlertCircle size={18} aria-hidden className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <button type="submit" disabled={pending} className={`${btnPrimary} w-full`}>
              {pending ? "Sending…" : "Submit request"}
              {!pending && <Send size={16} aria-hidden />}
            </button>
            <p className="mt-2 text-center text-xs text-brand-ink-soft">
              Support hours {SUPPORT_HOURS} · {REPLY_PROMISE}
            </p>
          </div>
        </>
      )}

      {!cat && error && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="flex items-start gap-2 text-sm font-medium text-brand-red outline-none">
          <AlertCircle size={16} aria-hidden className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}
    </form>
  );
}

function VerifyFirst({
  group,
  category,
  requestedOrderId,
  verifiedEmail,
  customerOrders,
  onGeneral,
}: {
  group: GroupKey;
  category: TicketCategory;
  requestedOrderId: string | null;
  verifiedEmail: string | null;
  customerOrders: Array<{ id: string; label: string }>;
  onGeneral: () => void;
}) {
  // Verified, but no order chosen yet: pick one of theirs.
  if (verifiedEmail && !requestedOrderId && customerOrders.length > 0) {
    return (
      <section aria-labelledby="choose-order" className="rounded-2xl border border-brand-line p-4 sm:p-5">
        <h2 id="choose-order" className="font-display text-lg font-bold text-brand-ink">
          Which order is this about?
        </h2>
        <ul className="mt-3 space-y-2">
          {customerOrders.map((o) => (
            <li key={o.id}>
              <Link
                href={`/support/new?order=${encodeURIComponent(o.id)}&category=${category}`}
                className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-brand-line px-4 py-2 text-sm hover:border-brand-ink"
              >
                <span className="min-w-0 break-words text-brand-ink">{o.label}</span>
                <ArrowRight size={16} aria-hidden className="shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-brand-ink-soft">
          Order not listed?{" "}
          <Link href={`/support/order?next=${nextFor(group)}`} className="font-semibold underline">
            Verify another order
          </Link>
          .
        </p>
      </section>
    );
  }
  const href = `/support/order?${requestedOrderId ? `id=${encodeURIComponent(requestedOrderId)}&` : ""}next=${nextFor(group)}`;
  return (
    <section aria-labelledby="verify-first" className="rounded-2xl border border-brand-ink bg-brand-cream p-4 sm:p-5">
      <h2 id="verify-first" className="flex items-center gap-2 font-display text-lg font-bold text-brand-ink">
        <Lock size={18} aria-hidden className="text-brand-red" />
        Verify your order to continue
      </h2>
      <p className="mt-2 text-sm text-brand-ink-soft leading-relaxed">
        For your privacy we first confirm it&apos;s your order. Enter the order ID and your phone or email — we email a
        6-digit code to the address on the order. It takes about a minute.
      </p>
      <div className="mt-4 flex flex-col sm:flex-row gap-3">
        <Link href={href} className={`${btnPrimary} flex-1`}>
          Verify my order
          <ArrowRight size={16} aria-hidden />
        </Link>
        <button type="button" onClick={onGeneral} className={btnOutline}>
          I don&apos;t have an order
        </button>
      </div>
    </section>
  );
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
}
