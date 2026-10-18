"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Script from "next/script";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Lock,
  MapPin,
  Minus,
  Plus,
  RotateCcw,
  ShieldCheck,
  Tag,
  Truck,
  X,
  AlertTriangle,
  ArrowRightLeft,
} from "lucide-react";
import { nanoid } from "nanoid";
import { AnnouncementBar } from "@/components/AnnouncementBar";
import { PayButton } from "@/components/PayButton";
import { trackFunnel } from "@/lib/funnel-client";
import {
  useCart,
  useCart16,
  getCartLines,
  getCartSubtotal,
  getCartCount,
} from "@/lib/cart-store";
import { PRODUCTS, defaultVariantSlug } from "@/lib/products";
import {
  resolveVariantAvailability,
  resolveProductAvailability,
  findComparableAlternatives,
} from "@/lib/availability";
import { useLiveStock } from "@/lib/use-live-stock";
import {
  AUTO_COUPON,
  COD_CONFIRMATION_16_MAX_INR,
  EMI,
  OFFERS,
  bundleDiscountInr,
  bundleTierLabel,
  computeCodConfirmationFee,
  emiMonthlyInr,
} from "@/lib/config";
import { formatINR } from "@/lib/utils";
import {
  USE_SHOPIFY_CHECKOUT,
  buildShopifyCartUrl,
  type ShopifyCartInput,
} from "@/lib/shopify";

type PaymentMethod = "upi" | "cod" | "emi";

/**
 * When NEXT_PUBLIC_USE_SHOPIFY_CHECKOUT=1, checkout is handed to Shopify: we
 * turn the current cart into a Shopify cart-permalink and redirect there so
 * Shopify owns payment / orders / inventory. Shown instead of the custom
 * Razorpay checkout below. Fully reversible — flip the flag off to restore it.
 */
function ShopifyCheckoutRedirect({
  items,
  hasHydrated,
  count,
  homeHref,
}: {
  items: ShopifyCartInput[];
  hasHydrated: boolean;
  count: number;
  homeHref: string;
}) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!hasHydrated) return;
    if (count === 0) {
      router.push(homeHref);
      return;
    }
    const url = buildShopifyCartUrl(items);
    if (url) {
      window.location.href = url;
    } else {
      // No line resolved to a Shopify variant — don't strand the buyer.
      setFailed(true);
    }
  }, [hasHydrated, count, items, router, homeHref]);

  return (
    <main className="bg-brand-cream min-h-screen grid place-items-center px-6 text-center">
      <div>
        {failed ? (
          <>
            <p className="text-brand-red font-semibold">
              Couldn&apos;t start secure checkout.
            </p>
            <button
              type="button"
              onClick={() => router.push(homeHref)}
              className="mt-4 underline text-brand-ink"
            >
              Back to store
            </button>
          </>
        ) : (
          <>
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand-line border-t-brand-red" />
            <p className="mt-4 text-brand-ink-soft">
              Taking you to secure checkout…
            </p>
          </>
        )}
      </div>
    </main>
  );
}

// Note: delivery ETA + serviceability now come from /api/serviceability
// (src/lib/serviceability.ts) — the same source the server gates orders with.

type Serviceability = {
  serviceable: boolean;
  codAvailable: boolean;
  etaText: string;
  reason: string | null;
};

type CreateOrderResponse = {
  ok: boolean;
  orderId: string;
  paymentMethod: "UPI" | "COD";
  razorpayOrderId?: string;
  razorpayKeyId?: string;
  amountInr: number;
  /** Partial-prepaid CoD only — what the courier collects at the door
   *  (totalInr − confirmationFeeInr). 0 for full prepaid. */
  codBalanceInr?: number;
  /** Partial-prepaid CoD only — the upfront Razorpay-captured amount. */
  confirmationFeeInr?: number;
  /** Echo of the order total — both UPI and CoD see this. */
  totalInr?: number;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
};

/**
 * Poll the public order endpoint until payment shows CAPTURED. The webhook
 * captures the payment server-side even when our inline /verify call fails, so
 * this lets us confirm success out-of-band. Resolves true once captured, or
 * false after the timeout — either way the caller redirects the customer to
 * their order so they are never left stranded after a successful payment.
 */
async function waitForCapture(
  orderId: string,
  attempts = 6,
  delayMs = 2000,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`/api/orders/${orderId}`);
      if (r.ok) {
        const d = (await r.json()) as { paymentStatus?: string; status?: string };
        if (d.paymentStatus === "CAPTURED" || d.status === "PAID") return true;
      }
    } catch {
      /* keep polling — transient network error */
    }
    await new Promise((res) => setTimeout(res, delayMs));
  }
  return false;
}

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: { ondismiss?: () => void };
};

type RazorpayInstance = {
  open(): void;
  on(
    event: "payment.failed",
    cb: (resp: { error?: { description?: string; reason?: string } }) => void,
  ): void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

function CheckoutPageInner() {
  const router = useRouter();
  // The /16 store checks out through this same page with ?store=16, driven by
  // its own isolated cart (useCart16). Everything downstream — pricing, coupons,
  // Razorpay/COD, the order API — is identical; only the cart source differs.
  const searchParams = useSearchParams();
  const is16 = searchParams.get("store") === "16";
  const cartApi = is16 ? useCart16 : useCart;
  const homeHref = is16 ? "/16" : "/";
  const items64 = useCart((s) => s.items);
  const items16 = useCart16((s) => s.items);
  const items = is16 ? items16 : items64;
  const hyd64 = useCart((s) => s.hasHydrated);
  const hyd16 = useCart16((s) => s.hasHydrated);
  const hasHydrated = is16 ? hyd16 : hyd64;

  const { stockMap, overrideMap, refresh: refreshStock } = useLiveStock();

  const lines = getCartLines(items, overrideMap);
  const subtotal = getCartSubtotal(items, overrideMap);
  const count = getCartCount(items);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [pincode, setPincode] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("upi");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True once Razorpay reports a successful payment and we're verifying /
  // waiting for capture. Keeps the customer informed and blocks re-submits.
  const [confirming, setConfirming] = useState(false);

  // Two-step checkout: "details" (contact + address) → "payment". Splitting the
  // page lets us capture the buyer's contact the moment they finish step 1 (see
  // saveLead below) so an abandoned checkout still leaves us a lead to call,
  // and keeps the payment screen distraction-free.
  const [step, setStep] = useState<"details" | "payment">("details");

  // Coupon UI state.
  const [couponCode, setCouponCode] = useState("");
  const [couponDiscountInr, setCouponDiscountInr] = useState(0);
  const [couponMessage, setCouponMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponApplied, setCouponApplied] = useState<string | null>(null);
  // True when the applied coupon is a "Name your price" bargain — the negotiated
  // FINAL price, which does NOT stack with the prepaid/bundle discounts.
  const [couponIsBargain, setCouponIsBargain] = useState(false);
  const lastCouponValidation = useRef<string | null>(null);

  // Geo-locate / auto-fill state
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoStatus, setGeoStatus] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  const [isTouchDevice, setIsTouchDevice] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    setIsTouchDevice(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  const beganCheckoutRef = useRef(false);
  useEffect(() => {
    if (beganCheckoutRef.current || subtotal <= 0) return;
    beganCheckoutRef.current = true;
    import("@/lib/analytics-client").then((m) =>
      m.trackInitiateCheckout(subtotal),
    );
    trackFunnel("checkout_started", {
      cartValueInr: subtotal,
      itemCount: getCartCount(items),
    });
  }, [subtotal, items]);

  const userTypedRef = useRef({
    pincode: false,
    line1: false,
    line2: false,
    city: false,
    state: false,
  });
  const pincodeInputRef = useRef<HTMLInputElement>(null);

  const [svc, setSvc] = useState<Serviceability | null>(null);
  const svcActive = pincode.length === 6 ? svc : null;

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const markTouched = (f: string) =>
    setTouched((t) => (t[f] ? t : { ...t, [f]: true }));

  const [paymentCancelled, setPaymentCancelled] = useState<string | null>(null);

  const autoCouponTried = useRef(false);
  const bgCouponTried = useRef(false);

  // Idempotency key — stable for retries of the same cart + payment method + coupon,
  // but rotates automatically if the buyer changes cart items, payment method, or coupon.
  const cartFingerprint = useMemo(
    () => JSON.stringify({ items, payment, couponApplied }),
    [items, payment, couponApplied],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const idempotencyKey = useMemo(() => nanoid(24), [cartFingerprint]);
  const submittingRef = useRef(false);
  const paidRef = useRef(false);

  useEffect(() => {
    // Wait for the persisted cart to rehydrate before treating it as empty —
    // otherwise a returning customer with a saved cart gets bounced home.
    if (hasHydrated && count === 0) {
      router.push(homeHref);
    }
  }, [hasHydrated, count, router, homeHref]);

  // If an applied coupon's discount would now be invalid (e.g. user removed
  // items and the new subtotal drops below the minimum), revalidate against
  // the server. If still valid, refresh the discount amount; if not, clear
  // the apply state so the customer doesn't see a misleading total.
  useEffect(() => {
    if (!couponApplied) return;
    // Skip the redundant fire that immediately follows an apply — those inputs
    // were just validated. Only hit the service when the subtotal has actually
    // moved since the last validation.
    const sig = `${couponApplied}|${subtotal}`;
    if (lastCouponValidation.current === sig) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/coupons/validate?code=${encodeURIComponent(couponApplied)}&siteId=${"prc"}&subtotalInr=${subtotal}&shippingInr=${subtotal >= OFFERS.freeShippingMinINR ? 0 : 85}&skuIds=${encodeURIComponent(items.map((i) => i.skuId).join(","))}`,
        );
        const data = (await r.json()) as {
          ok: boolean;
          code?: string;
          discountInr?: number;
          error?: string;
          isBargain?: boolean;
        };
        if (cancelled) return;
        if (!data.ok) {
          setCouponDiscountInr(0);
          setCouponApplied(null);
          setCouponIsBargain(false);
          setCouponMessage({
            kind: "error",
            text: `Coupon ${couponApplied} no longer valid: ${data.error ?? "rejected"}`,
          });
          return;
        }
        lastCouponValidation.current = sig;
        setCouponDiscountInr(data.discountInr ?? 0);
        setCouponIsBargain(!!data.isBargain);
      } catch {
        // Network failure during revalidate — leave the existing discount in
        // place; server-side validation at order create will be authoritative.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-runs when the cart subtotal OR the payment method changes, so the
    // shown discount + total always match what the server will compute.
  }, [couponApplied, subtotal, payment, is16]);

  // Threshold (metres) below which we trust the browser's geolocation result
  // enough to autofill an address. Real mobile GPS hardware delivers <30 m;
  // desktop Wi-Fi / IP geolocation typically reports 2000-50000 m. Anything
  // above this gate would just put a wrong address into the form.
  const GEO_ACCURACY_THRESHOLD_M = 500;

  /** Auto-focus the pincode field. Used as the fallback path whenever GPS
   *  fails or returns a low-quality result — gives the buyer an obvious next
   *  step instead of a vague error. */
  function focusPincode() {
    setTimeout(() => pincodeInputRef.current?.focus(), 0);
  }

  async function useMyLocation() {
    setGeoError(null);
    setGeoStatus(null);

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError(
        "Your browser doesn't support location detection. Type your pincode below — we'll fill the rest.",
      );
      focusPincode();
      return;
    }

    setGeoBusy(true);
    setGeoStatus("Detecting your location…");

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10_000,
          maximumAge: 60_000,
        });
      });

      // Accuracy gate. The browser reports the radius (metres) within which
      // it thinks the buyer is — on desktop without GPS hardware this is
      // typically 2-50 km via Wi-Fi / IP. Refusing to autofill at this
      // accuracy is strictly better than putting the wrong pincode in.
      const accuracy = pos.coords.accuracy ?? Infinity;
      if (accuracy > GEO_ACCURACY_THRESHOLD_M) {
        const km = Math.round(accuracy / 1000);
        throw new Error(
          km >= 1
            ? `Your device's location signal is ~${km} km off — too imprecise to autofill. Type your 6-digit pincode below; we'll fill city, state & area.`
            : `Your location signal isn't precise enough. Type your 6-digit pincode below; we'll fill the rest.`,
        );
      }

      setGeoStatus("Looking up your address…");
      const { latitude: lat, longitude: lon } = pos.coords;

      const r = await fetch(`/api/geocode/reverse?lat=${lat}&lon=${lon}`);
      const data = (await r.json()) as {
        ok?: boolean;
        pincode?: string;
        city?: string;
        state?: string;
        line1?: string;
        line2?: string;
        countryCode?: string;
        error?: string;
      };

      if (!r.ok || !data.ok) {
        throw new Error(data.error || "Couldn't read address from coordinates");
      }

      if (data.countryCode && data.countryCode !== "IN") {
        throw new Error(
          "We only ship within India. Please type a delivery address inside India.",
        );
      }

      // Autofill only into fields the buyer hasn't typed themselves. Anything
      // we write here is marked as system-set (userTyped = false) so that a
      // later pincode correction is allowed to refresh dependent fields.
      const typed = userTypedRef.current;
      if (data.pincode && !typed.pincode) setPincode(data.pincode);
      if (data.line1 && !typed.line1) setLine1(data.line1);
      if (data.line2 && !typed.line2) setLine2(data.line2);
      if (data.city && !typed.city) setCity(data.city);
      if (data.state && !typed.state) setStateName(data.state);

      setGeoStatus(
        "Address auto-filled. Add your flat / house / building no. on the first line.",
      );
    } catch (err: unknown) {
      const msg =
        err instanceof GeolocationPositionError
          ? err.code === 1
            ? "Location permission denied. Type your 6-digit pincode below."
            : err.code === 2
              ? "Couldn't get your location signal. Type your pincode below — we'll fill city, state & area."
              : "Location timed out. Type your pincode below — we'll fill city, state & area."
          : err instanceof Error
            ? err.message
            : String(err);
      setGeoError(msg);
      setGeoStatus(null);
      focusPincode();
    } finally {
      setGeoBusy(false);
    }
  }

  const shipping = subtotal >= OFFERS.freeShippingMinINR ? 0 : 85;
  const codFee =
    payment === "cod" && subtotal < OFFERS.codFeeAppliesBelowINR
      ? OFFERS.codFeeINR
      : 0;
  // Partial-prepaid CoD upfront amount (10 % of subtotal, ₹100-300, ₹50 step).
  // Shown in the CoD option's right-side number + subtitle copy.
  const codConfirmation = computeCodConfirmationFee(
    subtotal,
    is16 ? COD_CONFIRMATION_16_MAX_INR : undefined,
  );
  // Prepaid discount applies to any online method (UPI *or* EMI) — EMI is a
  // card charge, so it's prepaid too. Only COD forgoes the ₹100 off.
  const prepaidDiscount = payment !== "cod" ? OFFERS.prepaidDiscountINR : 0;
  // Bundle bonus — a PERCENTAGE off the subtotal by cart quantity
  // (2→5% · 3→10% · 4/5→15% · 6+→20%). Driven by TOTAL cart quantity, not
  // distinct SKUs.
  const bundleDiscount = bundleDiscountInr(count, subtotal);
  const bundleLabel = bundleTierLabel(count);
  // Bargain price is FINAL: a bargain coupon does NOT stack with the prepaid or
  // bundle discounts, EXCEPT it must never charge the customer MORE than the
  // standard auto-applied discounts (matching src/lib/pricing.ts & orders/create).
  const standardDiscounts = prepaidDiscount + bundleDiscount;
  const bargainActive =
    couponIsBargain &&
    couponDiscountInr > 0 &&
    couponDiscountInr >= standardDiscounts;
  const effPrepaidDiscount = bargainActive ? 0 : prepaidDiscount;
  const effBundleDiscount = bargainActive ? 0 : bundleDiscount;
  const effCouponDiscount =
    couponIsBargain && !bargainActive ? 0 : couponDiscountInr;
  const total = Math.max(
    0,
    subtotal + shipping + codFee - effPrepaidDiscount - effBundleDiscount - effCouponDiscount,
  );

  // Check if any line in the cart currently has a verified stock conflict
  const hasStockConflict = Boolean(
    stockMap &&
      lines.some((l) => {
        const vAvail = resolveVariantAvailability(
          l.sku,
          l.variantSlug,
          stockMap,
          overrideMap[l.sku.id],
        );
        return !vAvail.purchasable || l.qty > vAvail.availableQty;
      }),
  );

  const emiTotal = Math.max(
    0,
    subtotal + shipping - (bargainActive ? 0 : OFFERS.prepaidDiscountINR) - effBundleDiscount - effCouponDiscount,
  );
  const emiMonthly = emiMonthlyInr(emiTotal);
  const emiEligible = emiMonthly > 0;

  useEffect(() => {
    if (!emiEligible) setPayment((p) => (p === "emi" ? "upi" : p));
  }, [emiEligible]);

  const fieldErrors = useMemo(() => {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = "Enter your full name.";
    if (!/^\d{10}$/.test(phone)) e.phone = "Enter a valid 10-digit mobile number.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
      e.email = "Enter a valid email — your confirmation is sent here.";
    if (!/^\d{6}$/.test(pincode)) e.pincode = "Enter a valid 6-digit pincode.";
    if (line1.trim().length < 3) e.line1 = "Enter your address.";
    if (city.trim().length < 2) e.city = "Enter your city.";
    if (stateName.trim().length < 2) e.stateName = "Enter your state.";
    return e;
  }, [name, phone, email, pincode, line1, city, stateName]);

  const FIELD_ORDER = ["name", "phone", "email", "pincode", "line1", "city", "stateName"];

  function validate(): string | null {
    if (hasStockConflict) {
      return "An item in your cart is out of stock or exceeds available inventory. Please update or swap it above.";
    }
    for (const f of FIELD_ORDER) if (fieldErrors[f]) return fieldErrors[f];
    if (svcActive && !svcActive.serviceable)
      return svcActive.reason ?? "We don't deliver to this pincode yet.";
    if (payment === "cod" && svcActive && !svcActive.codAvailable)
      return (
        svcActive.reason ??
        "COD isn't available for this pincode — pay online instead."
      );
    return null;
  }

  // Step-1 gate. Same as validate() minus the payment-method checks (the buyer
  // hasn't chosen one yet on the details step).
  function validateDetails(): string | null {
    for (const f of FIELD_ORDER) if (fieldErrors[f]) return fieldErrors[f];
    if (svcActive && !svcActive.serviceable)
      return svcActive.reason ?? "We don't deliver to this pincode yet.";
    return null;
  }

  // Show a field's error only once the buyer has touched it (or tried to submit).
  const showErr = (f: string) => (touched[f] ? fieldErrors[f] : undefined);
  const inputCls = (f: string) =>
    `w-full px-4 py-3 rounded-lg border focus:outline-none text-brand-ink ${
      showErr(f) ? "border-brand-red" : "border-brand-line focus:border-brand-red"
    }`;

  async function applyCoupon(rawCode?: string, opts?: { silent?: boolean }) {
    const code = (rawCode ?? couponCode).trim().toUpperCase();
    if (!code) {
      if (!opts?.silent)
        setCouponMessage({ kind: "error", text: "Enter a code" });
      return;
    }
    setCouponBusy(true);
    if (!opts?.silent) setCouponMessage(null);
    try {
      const r = await fetch(
        `/api/coupons/validate?code=${encodeURIComponent(code)}&siteId=${"prc"}&subtotalInr=${subtotal}&shippingInr=${shipping}&skuIds=${encodeURIComponent(items.map((i) => i.skuId).join(","))}`,
      );
      const data = (await r.json()) as {
        ok: boolean;
        code?: string;
        discountInr?: number;
        error?: string;
        isBargain?: boolean;
      };
      if (!data.ok) {
        // Auto-apply failures are silent — the buyer never typed this code,
        // so a red error for an offer they didn't request would just confuse.
        if (!opts?.silent) {
          setCouponDiscountInr(0);
          setCouponApplied(null);
          setCouponIsBargain(false);
          setCouponMessage({ kind: "error", text: data.error ?? "Coupon rejected" });
        }
        return;
      }
      lastCouponValidation.current = `${data.code ?? code}|${subtotal}`;
      setCouponCode(data.code ?? code);
      setCouponDiscountInr(data.discountInr ?? 0);
      setCouponApplied(data.code ?? code);
      setCouponIsBargain(!!data.isBargain);
      setCouponMessage({
        kind: "ok",
        text: `Applied ${data.code ?? code} — ${formatINR(data.discountInr ?? 0)} off`,
      });
      // Bargain-won coupons are BG-prefixed — tag the funnel so we can measure
      // profit-per-visitor for the game (orders.coupon_code LIKE 'BG-%' is the
      // authoritative revenue source; this is the checkout-side signal).
      if ((data.code ?? code).toUpperCase().startsWith("BG-")) {
        trackFunnel("bargain_coupon_applied", { discountInr: data.discountInr ?? 0 });
      }
    } catch {
      if (!opts?.silent)
        setCouponMessage({ kind: "error", text: "Couldn't reach coupon service" });
    } finally {
      setCouponBusy(false);
    }
  }

  // Auto-apply was retired (2026-06-05): the prepaid -₹100 line is the only
  // headline discount now, so a coupon code would double-discount. Manual
  // coupon UI is also hidden in the JSX below; leaving the state + apply
  // handler alive in case we re-introduce a separate promo flow later.
  useEffect(() => {
    return;
    if (autoCouponTried.current) return;
    if (!hasHydrated || subtotal <= 0 || couponApplied) return;
    autoCouponTried.current = true;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/coupons/validate?code=${AUTO_COUPON.code}&siteId=${"prc"}&subtotalInr=${subtotal}&shippingInr=${shipping}`,
        );
        const data = (await r.json()) as {
          ok: boolean;
          code?: string;
          discountInr?: number;
        };
        if (cancelled || !data.ok) return;
        const applied = data.code ?? AUTO_COUPON.code;
        lastCouponValidation.current = `${applied}|${subtotal}`;
        setCouponCode(applied);
        setCouponDiscountInr(data.discountInr ?? 0);
        setCouponApplied(applied);
        setCouponMessage({
          kind: "ok",
          text: `Applied ${applied} — ${formatINR(data.discountInr ?? 0)} off`,
        });
      } catch {
        /* silent — the buyer can still apply it manually via the chip */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasHydrated, subtotal, couponApplied, shipping, is16]);

  // "Name your price" bargain: the buyer arrives from the game at
  // /checkout?bg=<CODE> with a real single-use, 5-minute coupon already minted.
  // Auto-apply it through the SAME validated path as any coupon (no pricing
  // logic touched) so their negotiated price is reflected the moment they land.
  // Runs once; a normal coupon the buyer applied manually always wins.
  useEffect(() => {
    if (bgCouponTried.current) return;
    const bg = searchParams.get("bg");
    if (!bg) return;
    if (!hasHydrated || subtotal <= 0 || couponApplied) return;
    bgCouponTried.current = true;
    void applyCoupon(bg);
  }, [hasHydrated, subtotal, couponApplied, searchParams, applyCoupon]);

  // Live serviceability check when a full pincode is entered. All state is set
  // after the await; staleness on partial pincodes is handled by `svcActive`.
  useEffect(() => {
    if (pincode.length !== 6) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/serviceability?pincode=${pincode}`);
        const data = (await r.json()) as Serviceability & { ok: boolean };
        if (cancelled) return;
        setSvc({
          serviceable: data.serviceable,
          codAvailable: data.codAvailable,
          etaText: data.etaText,
          reason: data.reason,
        });
        // If COD isn't available here and the buyer had COD selected, move them
        // to prepaid so they can't submit an order we'd have to cancel.
        if (data.serviceable && !data.codAvailable) {
          setPayment((p) => (p === "cod" ? "upi" : p));
        }
      } catch {
        /* leave previous result; server re-checks authoritatively at submit */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pincode]);

  // Pincode → city/state/area autofill (India Post API). The authoritative
  // path on desktop where GPS is unreliable. Critically, this REPLACES values
  // that we previously autofilled but PRESERVES anything the buyer has typed
  // themselves — driven by userTypedRef. That makes the "buyer corrects a
  // wrong GPS pincode" flow Just Work: the new pincode refreshes city/state/
  // area, never clobbering hand-typed fields.
  useEffect(() => {
    if (pincode.length !== 6) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/geocode/pincode?pincode=${pincode}`);
        if (!r.ok) return;
        const data = (await r.json()) as {
          ok?: boolean;
          city?: string;
          state?: string;
          areas?: string[];
        };
        if (cancelled || !data.ok) return;
        const typed = userTypedRef.current;
        if (data.city && !typed.city) setCity(data.city);
        if (data.state && !typed.state) setStateName(data.state);
        if (data.areas?.length && !typed.line2) setLine2(data.areas[0]);
      } catch {
        /* silent — buyer can still type city/state manually */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pincode]);

  function clearCoupon() {
    setCouponCode("");
    setCouponApplied(null);
    setCouponDiscountInr(0);
    setCouponIsBargain(false);
    setCouponMessage(null);
  }

  // Open the Razorpay modal for a created prepaid order. Extracted so the
  // "Retry payment" flow can reopen it against the SAME razorpay order_id
  // (Razorpay refuses a second charge on an order already paid, so reopening is
  // safe and never double-charges).
  const openRazorpay = useCallback(
    (data: CreateOrderResponse) => {
      if (!window.Razorpay || !data.razorpayOrderId || !data.razorpayKeyId) {
        setError("Razorpay didn't load. Refresh and try again.");
        submittingRef.current = false;
        setLoading(false);
        return;
      }
      paidRef.current = false;
      const rzp = new window.Razorpay({
        key: data.razorpayKeyId,
        amount: data.amountInr * 100,
        currency: "INR",
        name: "PRC Cars",
        description: `Order ${data.orderId}`,
        order_id: data.razorpayOrderId,
        prefill: {
          name: data.customerName,
          email: data.customerEmail,
          contact: data.customerPhone,
        },
        theme: { color: "#0A0A0A" },
        handler: async (response) => {
          // Payment SUCCEEDED at Razorpay. From here the customer must never be
          // stranded — if our verify call fails, the webhook still captures it.
          paidRef.current = true;
          trackFunnel(
            "payment_succeeded",
            { amountInr: data.amountInr },
            { orderId: data.orderId, immediate: true },
          );
          // Bargain attribution: a paid order that carries a BG- coupon came from
          // the game. (orders.coupon_code LIKE 'BG-%' is the authoritative source;
          // this is the client-side signal for the funnel.)
          if (couponApplied?.toUpperCase().startsWith("BG-")) {
            trackFunnel(
              "bargain_payment_success",
              { amountInr: data.amountInr },
              { orderId: data.orderId, immediate: true },
            );
          }
          setError(null);
          setPaymentCancelled(null);
          setConfirming(true);
          try {
            const v = await fetch(`/api/orders/${data.orderId}/verify`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              }),
            });
            const vData = await v.json().catch(() => ({}));
            if (!v.ok) throw new Error(vData.error || "Verification failed");
            cartApi.getState().clear();
            router.push(`/orders/${data.orderId}`);
          } catch {
            // Verify failed (network/timeout) but the money was taken. Wait for
            // the webhook to mark it captured, then take them to their order —
            // never show a "failed" state for a payment that actually went through.
            await waitForCapture(data.orderId);
            cartApi.getState().clear();
            router.push(`/orders/${data.orderId}`);
          } finally {
            submittingRef.current = false;
          }
        },
        modal: {
          ondismiss: () => {
            // Razorpay also fires ondismiss right after a successful payment —
            // don't reset state in that case, or the customer could re-submit
            // and get charged twice.
            if (paidRef.current) return;
            submittingRef.current = false;
            setLoading(false);
            trackFunnel(
              "payment_cancelled",
              {},
              { orderId: data.orderId, immediate: true },
            );
            setPaymentCancelled(
              "Payment wasn't completed — you weren't charged and your order is saved. Tap below to try again.",
            );
          },
        },
      });
      // Surface real payment failures (declined card, failed UPI) with a clear
      // retry, instead of leaving the buyer staring at the form wondering.
      rzp.on("payment.failed", (resp) => {
        if (paidRef.current) return;
        submittingRef.current = false;
        setLoading(false);
        const why = resp?.error?.description || resp?.error?.reason;
        trackFunnel(
          "payment_failed",
          { reason: why ?? null },
          { orderId: data.orderId, immediate: true },
        );
        setPaymentCancelled(
          `Payment failed${why ? ` — ${why}` : ""}. You weren't charged. Try again, or switch to Cash on Delivery.`,
        );
      });
      trackFunnel(
        "razorpay_opened",
        { amountInr: data.amountInr, paymentMethod: data.paymentMethod },
        { orderId: data.orderId, immediate: true },
      );
      rzp.open();
    },
    [router],
  );

  async function handlePlaceOrder() {
    // Synchronous guard against React state-batching double-fire.
    if (submittingRef.current) return;
    setError(null);
    setPaymentCancelled(null);
    // Surface every inline error on submit, even untouched fields.
    setTouched({
      name: true,
      phone: true,
      email: true,
      pincode: true,
      line1: true,
      city: true,
      stateName: true,
    });
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    try {
      const res = await fetch("/api/orders/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteId: "prc",
          idempotencyKey,
          items: items.map((i) => ({
            skuId: i.skuId,
            variantSlug: i.variantSlug,
            qty: i.qty,
          })),
          address: {
            fullName: name.trim(),
            phone,
            email: email.trim(),
            line1: line1.trim(),
            line2: line2.trim(),
            city: city.trim(),
            state: stateName.trim(),
            pincode,
          },
          paymentMethod:
            payment === "cod" ? "COD" : payment === "emi" ? "CARD" : "UPI",
          couponCode: couponApplied || undefined,
        }),
      });
      const data = (await res.json()) as CreateOrderResponse & {
        error?: string;
        code?: string;
        failedSkuId?: string;
        failedVariantSlug?: string | null;
        availableQty?: number;
      };
      if (!res.ok) {
        if (res.status === 409) {
          await refreshStock();
        }
        throw new Error(data.error || "Failed to create order");
      }

      if (data.paymentMethod === "COD" && !data.razorpayOrderId) {
        cartApi.getState().clear();
        router.push(`/orders/${data.orderId}`);
        return;
      }

      setLoading(false);
      openRazorpay(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      submittingRef.current = false;
      setLoading(false);
    }
  }

  // ── Lead capture (step 1) ──────────────────────────────────────────
  // We persist the buyer's contact + address the instant they finish the
  // details step (and again if they leave the page mid-step-1), so an
  // abandoned checkout still leaves us a callable lead — surfaced on
  // /admin/recovery. Side-effect-free server-side: no stock hold, no order.
  // Latest field values are mirrored into a ref so the pagehide listener
  // (registered once) always reads current state without re-subscribing.
  const leadStateRef = useRef({
    step,
    name,
    phone,
    email,
    pincode,
    line1,
    line2,
    city,
    stateName,
    items,
  });
  // Mirror the latest state into the ref after each render (not during) so the
  // once-registered pagehide listener always reads current values.
  useEffect(() => {
    leadStateRef.current = {
      step,
      name,
      phone,
      email,
      pincode,
      line1,
      line2,
      city,
      stateName,
      items,
    };
  });

  const buildLeadBody = useCallback(() => {
    const s = leadStateRef.current;
    return JSON.stringify({
      siteId: "prc",
      address: {
        fullName: s.name.trim(),
        phone: s.phone,
        email: s.email.trim(),
        line1: s.line1.trim(),
        line2: s.line2.trim(),
        city: s.city.trim(),
        state: s.stateName.trim(),
        pincode: s.pincode,
      },
      items: s.items.map((i) => ({
        skuId: i.skuId,
        variantSlug: i.variantSlug,
        qty: i.qty,
      })),
    });
  }, []);

  // Enough to be a useful lead: a real name + a valid 10-digit phone.
  const leadWorthSaving = useCallback(() => {
    const s = leadStateRef.current;
    return s.name.trim().length >= 2 && /^\d{10}$/.test(s.phone);
  }, []);

  // Serialized body of the last lead we successfully POSTed. Lets saveLead skip
  // a re-send when nothing has changed since — so the debounced autosave and
  // the pagehide/visibilitychange flushes don't spam identical rows or burn the
  // per-IP rate budget.
  const lastSavedBodyRef = useRef<string | null>(null);

  const saveLead = useCallback(
    async (opts?: { keepalive?: boolean }) => {
      if (!leadWorthSaving()) return;
      const body = buildLeadBody();
      // Nothing changed since the last save — don't re-POST.
      if (body === lastSavedBodyRef.current) return;
      lastSavedBodyRef.current = body;
      try {
        await fetch("/api/checkout/lead", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          keepalive: opts?.keepalive ?? false,
        });
      } catch {
        // Best-effort — never block or surface to the buyer. Drop the dedup
        // marker so a transient failure retries on the next change / flush.
        lastSavedBodyRef.current = null;
      }
    },
    [buildLeadBody, leadWorthSaving],
  );

  // Autosave the lead to the backend AS the buyer fills the details step —
  // debounced so we persist shortly after they stop typing, NOT only when they
  // click "Continue to payment". Together with the pagehide flush below this
  // means a half-filled checkout is captured the moment name + phone are valid,
  // even if the buyer never advances a step or the tab is killed without firing
  // an unload event. saveLead() dedupes, so an unchanged form doesn't re-POST.
  useEffect(() => {
    if (step !== "details" || !leadWorthSaving()) return;
    const t = setTimeout(() => void saveLead(), 1200);
    return () => clearTimeout(t);
  }, [
    step,
    name,
    phone,
    email,
    pincode,
    line1,
    line2,
    city,
    stateName,
    items,
    saveLead,
    leadWorthSaving,
  ]);

  // Capture the lead if the buyer leaves while still on the details step
  // (closed the tab, hit back, navigated away) — the most important drop-off
  // to recover. Registered once; reads live state via leadStateRef.
  useEffect(() => {
    const flush = () => {
      if (paidRef.current || submittingRef.current) return;
      if (leadStateRef.current.step !== "details") return;
      void saveLead({ keepalive: true });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [saveLead]);

  // Step 1 → Step 2. Validate the address, persist the lead, then reveal the
  // payment options.
  async function handleContinueToPayment() {
    setError(null);
    setTouched({
      name: true,
      phone: true,
      email: true,
      pincode: true,
      line1: true,
      city: true,
      stateName: true,
    });
    const validation = validateDetails();
    if (validation) {
      setError(validation);
      return;
    }
    // Fire-and-forget — the lead is a safety net, not a gate on reaching payment.
    void saveLead();
    setError(null);
    setStep("payment");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const ctaLabel = paymentCancelled
    ? `Retry payment · ${formatINR(total)}`
    : payment === "cod"
      ? `Pay ${formatINR(codConfirmation)} now · ${formatINR(total - codConfirmation)} on delivery`
      : payment === "emi"
        ? `Continue to EMI · ${formatINR(total)}`
        : `Pay ${formatINR(total)} via UPI`;

  const freeShipGap = Math.max(0, OFFERS.freeShippingMinINR - subtotal);
  // COD is offered unless we've confirmed this pincode can't do COD.
  const codDisabled = !!svcActive?.serviceable && !svcActive.codAvailable;
  const notServiceable = !!svcActive && !svcActive.serviceable;

  // Shopify-checkout mode: skip the entire custom Razorpay/COD flow and hand
  // the cart to Shopify. All hooks above still run (rules-of-hooks safe); we
  // only swap what renders. Flip the flag off to restore the custom checkout.
  if (USE_SHOPIFY_CHECKOUT) {
    return (
      <ShopifyCheckoutRedirect
        items={items}
        hasHydrated={hasHydrated}
        count={count}
        homeHref={homeHref}
      />
    );
  }

  return (
    <>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="lazyOnload"
      />
      <AnnouncementBar />

      <main className="bg-brand-cream min-h-screen py-6 sm:py-12 px-5 sm:px-6">
        <div className="max-w-2xl mx-auto">
          {/* Back button — checkout has no <Header /> (intentional, to keep
              the conversion page distraction-free), so we ship the back
              affordance inline. router.back() preserves Next.js scroll
              state; falls back to home for deep-link landings. */}
          <button
            type="button"
            onClick={() => {
              // On the payment step, "Back" returns to the details step rather
              // than leaving checkout entirely.
              if (step === "payment") {
                setStep("details");
                if (typeof window !== "undefined")
                  window.scrollTo({ top: 0, behavior: "smooth" });
                return;
              }
              if (typeof window !== "undefined" && window.history.length > 1) {
                router.back();
              } else {
                router.push(homeHref);
              }
            }}
            aria-label="Go back"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-ink-soft hover:text-brand-ink mb-4 -ml-1 px-2 py-1 rounded-md hover:bg-brand-ink/5 transition-colors"
          >
            <ChevronLeft size={18} strokeWidth={2.5} />
            <span>{step === "payment" ? "Back to details" : "Back"}</span>
          </button>

          <h1 className="text-3xl font-bold text-brand-ink">Checkout</h1>
          <p className="text-brand-ink-soft mt-2">
            {step === "details"
              ? "Step 1 of 2 — your delivery details."
              : "Step 2 of 2 — choose how to pay."}
          </p>

          {/* Step indicator. The completed step (1, once on payment) is
              tappable to jump back and edit. */}
          <div className="mt-5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (step === "payment") {
                  setStep("details");
                  if (typeof window !== "undefined")
                    window.scrollTo({ top: 0, behavior: "smooth" });
                }
              }}
              className={`flex items-center gap-2 text-sm font-semibold ${
                step === "payment"
                  ? "text-brand-ink cursor-pointer"
                  : "text-brand-ink cursor-default"
              }`}
              aria-current={step === "details" ? "step" : undefined}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                  step === "payment"
                    ? "bg-success text-white"
                    : "bg-brand-ink text-white"
                }`}
              >
                {step === "payment" ? <CheckCircle2 size={14} /> : "1"}
              </span>
              Details
            </button>
            <div className="h-px flex-1 bg-brand-line" />
            <div
              className={`flex items-center gap-2 text-sm font-semibold ${
                step === "payment" ? "text-brand-ink" : "text-brand-ink-soft"
              }`}
              aria-current={step === "payment" ? "step" : undefined}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                  step === "payment"
                    ? "bg-brand-ink text-white"
                    : "bg-brand-line text-brand-ink-soft"
                }`}
              >
                2
              </span>
              Payment
            </div>
          </div>

          {(step === "details" || hasStockConflict) && (
          <div className="mt-6 bg-white rounded-2xl border border-brand-line p-5">
            <div className="flex justify-between items-baseline">
              <div className="font-semibold text-brand-ink">Order summary</div>
              <div className="text-xs font-mono uppercase tracking-widest text-brand-ink-soft">
                {count} {count === 1 ? "item" : "items"}
              </div>
            </div>

            <ul className="mt-4 space-y-3">
              {lines.map((l) => {
                const ov = overrideMap[l.sku.id];
                const vAvail = resolveVariantAvailability(
                  l.sku,
                  l.variantSlug,
                  stockMap,
                  ov,
                );
                const pAvail = resolveProductAvailability(
                  l.sku,
                  stockMap,
                  ov,
                );
                const isSoldOut = Boolean(stockMap && !vAvail.purchasable);
                const isOverQty = Boolean(
                  stockMap && vAvail.purchasable && l.qty > vAvail.availableQty,
                );
                const alternateColor =
                  isSoldOut && pAvail.firstInStockVariantSlug
                    ? l.sku.colors?.find(
                        (c) => c.slug === pAvail.firstInStockVariantSlug,
                      )
                    : undefined;
                const comparableSku =
                  isSoldOut && !alternateColor
                    ? findComparableAlternatives(
                        l.sku,
                        PRODUCTS,
                        stockMap,
                        overrideMap,
                        1,
                      )[0]
                    : undefined;

                const dec = () =>
                  cartApi
                    .getState()
                    .setQty(
                      l.sku.id,
                      l.variantSlug,
                      l.qty - 1,
                      vAvail.maxOrderQty || 10,
                    );
                const inc = () =>
                  cartApi
                    .getState()
                    .setQty(
                      l.sku.id,
                      l.variantSlug,
                      l.qty + 1,
                      vAvail.maxOrderQty || 10,
                    );
                const rm = () =>
                  cartApi.getState().remove(l.sku.id, l.variantSlug);
                const labelSuffix = l.variantName ? ` (${l.variantName})` : "";
                return (
                  <li
                    key={`${l.sku.id}-${l.variantSlug ?? "default"}`}
                    className="flex flex-col gap-2 border-t border-brand-line pt-3 first:border-t-0 first:pt-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative w-14 h-14 sm:w-16 sm:h-16 shrink-0 rounded-lg overflow-hidden bg-brand-cream border border-brand-line">
                        <Image
                          src={l.variantImage ?? l.sku.heroImage}
                          alt={l.sku.name + labelSuffix}
                          fill
                          sizes="64px"
                          className={`object-cover ${
                            isSoldOut ? "opacity-50 grayscale-[35%]" : ""
                          }`}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-brand-ink text-sm leading-tight truncate flex items-center gap-1.5">
                          <span className="truncate">
                            {l.sku.name}
                            {l.variantName ? (
                              <span className="text-brand-ink-soft font-normal">
                                {" "}
                                · {l.variantName}
                              </span>
                            ) : null}
                          </span>
                          {isSoldOut && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-brand-red text-white text-[10px] font-bold uppercase tracking-wide shrink-0">
                              SOLD OUT
                            </span>
                          )}
                          {!isSoldOut && vAvail.status === "LOW_STOCK" && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-semibold shrink-0">
                              Only {vAvail.availableQty} left
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-brand-ink-soft mt-0.5">
                          {l.sku.scale} · {formatINR(l.unitPriceINR)} each
                        </div>
                        <div className="mt-2 inline-flex items-center border border-brand-line rounded-full overflow-hidden">
                          <button
                            type="button"
                            onClick={dec}
                            aria-label={`Decrease ${l.sku.name}${labelSuffix} quantity`}
                            className="h-11 w-11 flex items-center justify-center text-brand-ink hover:bg-brand-cream disabled:text-brand-ink-soft"
                            disabled={l.qty <= 1}
                          >
                            <Minus size={14} aria-hidden />
                          </button>
                          <span className="px-2 min-w-[1.5rem] text-center text-sm font-semibold tabular-nums text-brand-ink">
                            {l.qty}
                          </span>
                          <button
                            type="button"
                            onClick={inc}
                            disabled={
                              isSoldOut ||
                              (vAvail.stockKnown && l.qty >= vAvail.maxOrderQty)
                            }
                            aria-label={`Increase ${l.sku.name}${labelSuffix} quantity`}
                            className="h-11 w-11 flex items-center justify-center text-brand-ink hover:bg-brand-cream disabled:opacity-35 disabled:cursor-not-allowed"
                          >
                            <Plus size={14} aria-hidden />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <div className="text-sm font-semibold text-brand-ink">
                          {formatINR(l.lineTotalINR)}
                        </div>
                        <button
                          type="button"
                          onClick={rm}
                          aria-label={`Remove ${l.sku.name}${labelSuffix} from cart`}
                          className="h-11 w-11 flex items-center justify-center text-brand-ink-soft hover:text-brand-red"
                        >
                          <X size={16} aria-hidden />
                        </button>
                      </div>
                    </div>

                    {isOverQty && (
                      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5">
                          <AlertTriangle size={13} className="shrink-0" />
                          Only {vAvail.availableQty} left in stock
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            cartApi
                              .getState()
                              .setQty(
                                l.sku.id,
                                l.variantSlug,
                                vAvail.availableQty,
                                vAvail.availableQty,
                              );
                            setError(null);
                          }}
                          className="font-bold underline hover:no-underline shrink-0"
                        >
                          Reduce to {vAvail.availableQty}
                        </button>
                      </div>
                    )}

                    {isSoldOut && (
                      <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-xs text-red-900 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            This item is currently out of stock. Other items in
                            your cart remain untouched.
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              rm();
                              setError(null);
                            }}
                            className="font-semibold underline shrink-0"
                          >
                            Remove item
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {alternateColor && (
                            <button
                              type="button"
                              onClick={() => {
                                trackFunnel("alternative_click", {
                                  skuId: l.sku.id,
                                  targetSkuId: l.sku.id,
                                  variantSlug: alternateColor.slug,
                                  placement: "checkout",
                                });
                                cartApi
                                  .getState()
                                  .replaceItem(
                                    l.sku.id,
                                    l.variantSlug,
                                    l.sku.id,
                                    alternateColor.slug,
                                    1,
                                  );
                                setError(null);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-red-200 text-brand-ink font-semibold hover:bg-brand-cream transition-colors"
                            >
                              <ArrowRightLeft size={12} />
                              Switch to {alternateColor.name} (In stock)
                            </button>
                          )}
                          {!alternateColor && comparableSku && (
                            <button
                              type="button"
                              onClick={() => {
                                const targetVariant = defaultVariantSlug(
                                  comparableSku,
                                  stockMap,
                                );
                                trackFunnel("alternative_click", {
                                  skuId: l.sku.id,
                                  targetSkuId: comparableSku.id,
                                  variantSlug: targetVariant ?? "",
                                  placement: "checkout",
                                });
                                cartApi
                                  .getState()
                                  .replaceItem(
                                    l.sku.id,
                                    l.variantSlug,
                                    comparableSku.id,
                                    targetVariant,
                                    1,
                                  );
                                setError(null);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-red-200 text-brand-ink font-semibold hover:bg-brand-cream transition-colors"
                            >
                              <ArrowRightLeft size={12} />
                              Swap with {comparableSku.name} (
                              {formatINR(comparableSku.retailINR)})
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 pt-3 border-t border-brand-line flex justify-between items-baseline">
              <span className="text-sm text-brand-ink-soft">Subtotal</span>
              <span className="font-semibold text-brand-ink">
                {formatINR(subtotal)}
              </span>
            </div>
          </div>
          )}

          {step === "details" && (
          <>
          <div className="mt-6 bg-white rounded-2xl border border-brand-line p-5">
            <h2 className="font-semibold text-brand-ink">
              Where should we ship?
            </h2>

            {/* Address autofill paths:
                  • Mobile / tablet — GPS button (accuracy-gated, refuses
                    low-quality fixes).
                  • Desktop — pincode field is the authoritative input. GPS on
                    desktop falls back to IP geolocation which is 2-50 km off
                    in India; showing the button there just produces wrong
                    addresses and angry buyers.
                Both paths converge on the same pincode → city/state/area
                lookup via /api/geocode/pincode. */}
            {isTouchDevice ? (
              <>
                <button
                  type="button"
                  onClick={useMyLocation}
                  disabled={geoBusy}
                  className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-brand-line bg-brand-cream hover:border-brand-red hover:text-brand-red disabled:opacity-60 disabled:cursor-progress px-4 py-3 text-sm font-semibold text-brand-ink transition-colors"
                >
                  <MapPin size={16} className="text-brand-red" aria-hidden />
                  {geoBusy ? "Detecting…" : "Use my current location"}
                </button>
                {geoStatus && !geoError && (
                  <p className="mt-2 text-xs text-success">{geoStatus}</p>
                )}
                {geoError && (
                  <p className="mt-2 text-xs text-brand-red">{geoError}</p>
                )}
              </>
            ) : (
              <p className="mt-4 text-xs text-brand-ink-soft inline-flex items-start gap-1.5">
                <MapPin size={14} className="text-brand-red shrink-0 mt-0.5" aria-hidden />
                <span>
                  Tip: just type your 6-digit pincode below — city, state and
                  area auto-fill. Location detection works on phones only.
                </span>
              </p>
            )}

            <div className="mt-4 space-y-3">
              <div>
                <input
                  type="text"
                  placeholder="Full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => markTouched("name")}
                  className={inputCls("name")}
                />
                {showErr("name") && (
                  <p className="mt-1 text-xs text-brand-red">{showErr("name")}</p>
                )}
              </div>
              <div>
                <div
                  className={`flex items-stretch border rounded-lg overflow-hidden ${
                    showErr("phone")
                      ? "border-brand-red"
                      : "border-brand-line focus-within:border-brand-red"
                  }`}
                >
                  <span className="px-3 py-3 bg-brand-cream text-brand-ink-soft text-sm font-mono flex items-center">
                    +91
                  </span>
                  <input
                    type="tel"
                    placeholder="10-digit mobile"
                    value={phone}
                    onChange={(e) =>
                      setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
                    }
                    onBlur={() => markTouched("phone")}
                    className="flex-1 px-4 py-3 focus:outline-none text-brand-ink"
                  />
                </div>
                {showErr("phone") && (
                  <p className="mt-1 text-xs text-brand-red">{showErr("phone")}</p>
                )}
              </div>
              <div>
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => markTouched("email")}
                  className={inputCls("email")}
                />
                {showErr("email") && (
                  <p className="mt-1 text-xs text-brand-red">{showErr("email")}</p>
                )}
              </div>
              <div>
                <input
                  ref={pincodeInputRef}
                  type="text"
                  inputMode="numeric"
                  placeholder="Pincode (6 digit)"
                  value={pincode}
                  onChange={(e) => {
                    userTypedRef.current.pincode = true;
                    setPincode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  }}
                  onBlur={() => markTouched("pincode")}
                  className={inputCls("pincode")}
                />
                {showErr("pincode") && (
                  <p className="mt-1 text-xs text-brand-red">{showErr("pincode")}</p>
                )}
                {/* Live delivery ETA + serviceability. Same result the server
                    gates the order with — no surprise cancellations later. */}
                {pincode.length === 6 && !svcActive && (
                  <p className="mt-1.5 text-xs text-brand-ink-soft">
                    Checking delivery to {pincode}…
                  </p>
                )}
                {svcActive?.serviceable && (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-success">
                    <Truck size={14} aria-hidden />
                    Delivery to {pincode} by {svcActive.etaText}
                  </p>
                )}
                {svcActive && !svcActive.serviceable && (
                  <p className="mt-1.5 text-sm text-brand-red">
                    {svcActive.reason ?? "We don't deliver to this pincode yet."}
                  </p>
                )}
                {svcActive?.serviceable && !svcActive.codAvailable && (
                  <p className="mt-1 text-xs text-brand-ink-soft">
                    COD isn&apos;t available here — pay online (you save ₹100).
                  </p>
                )}
              </div>
              <div>
                <input
                  type="text"
                  placeholder="House / flat no, building, street"
                  value={line1}
                  onChange={(e) => {
                    userTypedRef.current.line1 = true;
                    setLine1(e.target.value);
                  }}
                  onBlur={() => markTouched("line1")}
                  className={inputCls("line1")}
                />
                {showErr("line1") && (
                  <p className="mt-1 text-xs text-brand-red">{showErr("line1")}</p>
                )}
              </div>
              <input
                type="text"
                placeholder="Area / landmark (optional)"
                value={line2}
                onChange={(e) => {
                  userTypedRef.current.line2 = true;
                  setLine2(e.target.value);
                }}
                className="w-full px-4 py-3 rounded-lg border border-brand-line focus:outline-none focus:border-brand-red text-brand-ink"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <input
                    type="text"
                    placeholder="City"
                    value={city}
                    onChange={(e) => {
                      userTypedRef.current.city = true;
                      setCity(e.target.value);
                    }}
                    onBlur={() => markTouched("city")}
                    className={inputCls("city")}
                  />
                  {showErr("city") && (
                    <p className="mt-1 text-xs text-brand-red">{showErr("city")}</p>
                  )}
                </div>
                <div>
                  <input
                    type="text"
                    placeholder="State"
                    value={stateName}
                    onChange={(e) => {
                      userTypedRef.current.state = true;
                      setStateName(e.target.value);
                    }}
                    onBlur={() => markTouched("stateName")}
                    className={inputCls("stateName")}
                  />
                  {showErr("stateName") && (
                    <p className="mt-1 text-xs text-brand-red">
                      {showErr("stateName")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
          </>
          )}

          {step === "payment" && (
          <>
          {/* Step-2 delivery recap — confirms where it's going without the buyer
              re-scanning the form. "Edit" jumps back to step 1. */}
          <div className="mt-6 bg-white rounded-2xl border border-brand-line p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-mono uppercase tracking-widest text-brand-ink-soft">
                  Delivering to
                </div>
                <div className="font-semibold text-brand-ink mt-1 truncate">
                  {name}
                </div>
                <div className="text-sm text-brand-ink-soft mt-0.5">
                  {[line1, line2].filter(Boolean).join(", ")}
                </div>
                <div className="text-sm text-brand-ink-soft">
                  {[city, stateName].filter(Boolean).join(", ")} {pincode}
                </div>
                <div className="text-sm text-brand-ink-soft mt-1">
                  +91 {phone}
                  {email ? ` · ${email}` : ""}
                </div>
                {svcActive?.serviceable && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-success">
                    <Truck size={14} aria-hidden />
                    Delivery by {svcActive.etaText}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setStep("details");
                  if (typeof window !== "undefined")
                    window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="shrink-0 text-sm font-semibold text-brand-red hover:underline"
              >
                Edit
              </button>
            </div>
          </div>

          <div className="mt-6 bg-white rounded-2xl border border-brand-line p-5">
            <h2 className="font-semibold text-brand-ink">
              How would you like to pay?
            </h2>
            <div className="mt-4 space-y-3">
              <label
                className={
                  payment === "upi"
                    ? "rounded-xl border border-brand-red p-4 cursor-pointer ring-2 ring-brand-red bg-brand-red-soft flex items-start gap-3"
                    : "rounded-xl border border-brand-line p-4 cursor-pointer flex items-start gap-3"
                }
              >
                <input
                  type="radio"
                  name="payment"
                  checked={payment === "upi"}
                  onChange={() => {
                    setPayment("upi");
                    trackFunnel("payment_method_selected", { method: "UPI" });
                  }}
                  className="mt-1 accent-brand-red"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-brand-ink">
                      Pay with UPI · save ₹100
                    </span>
                    <span className="bg-brand-red text-white text-xs px-2 py-0.5 rounded-full">
                      Recommended
                    </span>
                  </div>
                  <div className="text-sm text-brand-ink-soft mt-1">
                    PhonePe · Google Pay · Paytm
                  </div>
                </div>
              </label>

              {emiEligible && (
                <label
                  className={
                    payment === "emi"
                      ? "rounded-xl border border-brand-red p-4 cursor-pointer ring-2 ring-brand-red bg-brand-red-soft flex items-start gap-3"
                      : "rounded-xl border border-brand-line p-4 cursor-pointer flex items-start gap-3"
                  }
                >
                  <input
                    type="radio"
                    name="payment"
                    checked={payment === "emi"}
                    onChange={() => {
                      setPayment("emi");
                      trackFunnel("payment_method_selected", { method: "EMI" });
                    }}
                    className="mt-1 accent-brand-red"
                  />
                  <div className="flex-1 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-brand-ink">
                          Pay in EMI
                        </span>
                        <span className="bg-brand-ink text-white text-xs px-2 py-0.5 rounded-full">
                          No-Cost EMI
                        </span>
                      </div>
                      <div className="text-sm text-brand-ink-soft mt-1">
                        Credit / Debit card EMI · pick your bank & tenure in the
                        next step
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-brand-ink tabular-nums">
                        {formatINR(emiMonthly)}
                      </div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-brand-ink-soft mt-0.5">
                        /mo × {EMI.tenureMonths}
                      </div>
                    </div>
                  </div>
                </label>
              )}

              <label
                className={
                  codDisabled
                    ? "rounded-xl border border-brand-line p-4 opacity-50 cursor-not-allowed flex items-start gap-3"
                    : payment === "cod"
                      ? "rounded-xl border border-brand-red p-4 cursor-pointer ring-2 ring-brand-red bg-brand-red-soft flex items-start gap-3"
                      : "rounded-xl border border-brand-line p-4 cursor-pointer flex items-start gap-3"
                }
              >
                <input
                  type="radio"
                  name="payment"
                  checked={payment === "cod"}
                  onChange={() => {
                    setPayment("cod");
                    trackFunnel("payment_method_selected", { method: "COD" });
                  }}
                  disabled={codDisabled}
                  className="mt-1 accent-brand-red"
                />
                {/* HGT-mirror psychology:
                    - Title leads with the SMALL number (low-commitment anchor).
                    - Subtitle shows the split math plainly (₹150 + ₹1,249 = ₹1,399)
                      so the customer feels in control, no surprise fees.
                    - Right-side number shows the upfront ₹150, making CoD feel
                      LIGHTER than UPI — inverts the usual "CoD = scary commit". */}
                <div className="flex-1 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-brand-ink">
                      {codDisabled
                        ? "Cash on Delivery"
                        : `Pay ₹${codConfirmation} now and rest Cash on Delivery`}
                    </div>
                    <div className="text-sm text-brand-ink-soft mt-1">
                      {codDisabled
                        ? "Not available for this pincode — pay online to order."
                        : `Pay ₹${codConfirmation} now and ₹${total - codConfirmation} on delivery.`}
                    </div>
                  </div>
                  {!codDisabled && (
                    <div className="text-right shrink-0">
                      <div className="font-bold text-brand-ink tabular-nums">
                        ₹{codConfirmation}
                      </div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-brand-ink-soft mt-0.5">
                        now
                      </div>
                    </div>
                  )}
                </div>
              </label>
            </div>

            {/* Payment trust badges — compact single-line variant. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-brand-line pt-3 text-[11px] text-brand-ink-soft">
              <span className="inline-flex items-center gap-1 font-semibold text-brand-ink">
                <Lock size={11} className="text-success" aria-hidden />
                Secure
              </span>
              <span aria-hidden>·</span>
              <span>UPI · Cards · {emiEligible ? "EMI · " : ""}Net Banking</span>
              <span aria-hidden>·</span>
              <span>Razorpay</span>
            </div>
          </div>

          <div className="mt-6 bg-white rounded-2xl border border-brand-line p-5">
            <h2 className="font-semibold text-brand-ink flex items-center gap-2">
              <Tag size={16} className="text-brand-red" aria-hidden />
              Coupon code
            </h2>

            {/* AUTO_COUPON suggestion chip hidden 2026-06-05 — the prepaid
                -₹100 line is now the only ₹100-off mechanism. Manual entry
                below is still live for any future promo codes the team hands
                out. Re-enable the chip by flipping the false gate to true. */}
            {false && (
              couponApplied?.toUpperCase() === AUTO_COUPON.code ? (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5">
                  <CheckCircle2 size={16} className="text-success shrink-0" aria-hidden />
                  <span className="text-sm font-semibold text-success">
                    {AUTO_COUPON.code} applied — {AUTO_COUPON.label}
                  </span>
                </div>
              ) : !couponApplied ? (
                <button
                  type="button"
                  onClick={() => applyCoupon(AUTO_COUPON.code)}
                  disabled={couponBusy || subtotal <= 0}
                  className="mt-3 w-full flex items-center justify-between gap-2 rounded-lg border border-dashed border-brand-red bg-brand-red-soft px-3 py-2.5 text-left disabled:opacity-50"
                >
                  <span className="text-sm font-semibold text-brand-ink">
                    🎁 {AUTO_COUPON.label} ·{" "}
                    <span className="font-mono">{AUTO_COUPON.code}</span>
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wide text-brand-red">
                    {couponBusy ? "Applying…" : "Apply"}
                  </span>
                </button>
              ) : null
            )}

            <div className="mt-3 flex items-stretch gap-2">
              <input
                type="text"
                inputMode="text"
                autoComplete="off"
                placeholder="Have another code?"
                value={couponCode}
                onChange={(e) =>
                  setCouponCode(e.target.value.toUpperCase().slice(0, 40))
                }
                disabled={!!couponApplied || couponBusy}
                className="flex-1 px-4 py-3 rounded-lg border border-brand-line focus:outline-none focus:border-brand-red text-brand-ink disabled:bg-brand-cream"
              />
              {couponApplied ? (
                <button
                  type="button"
                  onClick={clearCoupon}
                  className="px-4 py-3 rounded-lg border border-brand-line bg-white text-brand-ink-soft font-semibold hover:text-brand-red"
                >
                  Remove
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => applyCoupon()}
                  disabled={couponBusy || !couponCode.trim()}
                  className="px-5 py-3 rounded-lg bg-brand-ink text-white font-semibold disabled:opacity-50"
                >
                  {couponBusy ? "Checking…" : "Apply"}
                </button>
              )}
            </div>
            {couponMessage && (
              <p
                className={
                  "mt-2 text-xs " +
                  (couponMessage.kind === "ok" ? "text-success" : "text-brand-red")
                }
              >
                {couponMessage.text}
              </p>
            )}
          </div>

          <div className="mt-6 bg-white rounded-2xl border border-brand-line p-5 space-y-2 text-brand-ink">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatINR(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Shipping</span>
              <span className={shipping === 0 ? "text-success font-semibold" : ""}>
                {shipping === 0 ? "FREE" : formatINR(shipping)}
              </span>
            </div>
            {freeShipGap > 0 && (
              <p className="text-xs text-brand-red">
                Add {formatINR(freeShipGap)} more to unlock FREE shipping.
              </p>
            )}
            {codFee > 0 && (
              <div className="flex justify-between">
                <span>COD fee</span>
                <span>{formatINR(codFee)}</span>
              </div>
            )}
            {/* Prepaid + bundle bonuses are hidden for a bargain order — the
                negotiated price is final and doesn't stack with them. */}
            {!bargainActive && prepaidDiscount > 0 && (
              <div className="flex justify-between text-success">
                <span>Online-pay bonus</span>
                <span>-{formatINR(prepaidDiscount)}</span>
              </div>
            )}
            {!bargainActive && bundleDiscount > 0 && (
              <div className="flex justify-between text-success">
                <span>Bundle bonus{bundleLabel ? ` (${bundleLabel})` : ""}</span>
                <span>-{formatINR(bundleDiscount)}</span>
              </div>
            )}
            {couponDiscountInr > 0 && (
              <div className="flex justify-between text-success">
                <span>
                  {bargainActive
                    ? "Private negotiated price applied"
                    : `Coupon${couponApplied ? ` (${couponApplied})` : ""}`}
                </span>
                <span>-{formatINR(couponDiscountInr)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-brand-line pt-3 mt-3 font-bold text-lg">
              <span>Total</span>
              <span>{formatINR(total)}</span>
            </div>
          </div>
          </>
          )}

          <div className="sticky bottom-0 mt-6 -mx-5 px-5 sm:-mx-6 sm:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-brand-cream/95 backdrop-blur border-t border-brand-line lg:static lg:bg-transparent lg:border-0 lg:mx-0 lg:px-0 lg:py-0">
            {confirming ? (
              <div className="mb-3 rounded-lg border border-success bg-success/10 px-4 py-3 text-sm text-success">
                Payment received — confirming your order… please don&apos;t close
                this page.
              </div>
            ) : paymentCancelled ? (
              <div className="mb-3 rounded-lg border border-gold bg-gold/10 px-4 py-3 text-sm text-brand-ink">
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <RotateCcw size={14} className="text-gold" aria-hidden />
                  Payment not completed
                </span>
                <p className="mt-1 text-brand-ink-soft">{paymentCancelled}</p>
              </div>
            ) : error ? (
              <div className="mb-3 rounded-lg border border-brand-red bg-brand-red-soft px-4 py-3 text-sm text-brand-red">
                {error}
              </div>
            ) : null}
            {step === "details" ? (
              <button
                type="button"
                onClick={handleContinueToPayment}
                disabled={notServiceable}
                className="group w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-ink px-6 py-4 text-lg font-bold text-white transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_5px_15px_rgba(0,0,0,0.4)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
              >
                Continue to payment
                <ChevronRight
                  size={20}
                  strokeWidth={2.5}
                  className="transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </button>
            ) : (
              <PayButton
                label={
                  confirming
                    ? "Payment received — confirming…"
                    : loading
                      ? "Placing order..."
                      : ctaLabel
                }
                onClick={handlePlaceOrder}
                disabled={loading || confirming || notServiceable}
                loading={loading || confirming}
                className="w-full text-lg"
              />
            )}
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-brand-ink-soft text-center">
              <ShieldCheck size={13} className="text-success" aria-hidden />
              Secure checkout · 7-Day Free Replacement · Ships in 24 hrs from
              Bangalore
            </p>
          </div>
        </div>
      </main>
    </>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutPageInner />
    </Suspense>
  );
}
