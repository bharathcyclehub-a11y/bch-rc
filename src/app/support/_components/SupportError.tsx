"use client";

import Link from "next/link";
import { AlertCircle, RotateCw } from "lucide-react";
import SupportShell from "./SupportShell";
import { SUPPORT_HOURS, WhatsAppButton, btnDark, btnOutline } from "./ui";

/** Shared body for the Support Centre error.tsx boundaries. */
export default function SupportError({ reset, what = "this page" }: { reset: () => void; what?: string }) {
  return (
    <SupportShell crumbs={[{ label: "Something went wrong" }]}>
      <section className="max-w-3xl mx-auto px-4 py-10 sm:py-14">
        <div role="alert" className="rounded-2xl border border-brand-line bg-brand-cream p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <AlertCircle size={22} aria-hidden className="mt-0.5 shrink-0 text-brand-red" />
            <div className="min-w-0">
              <h1 className="font-display text-xl font-bold text-brand-ink">We couldn&apos;t load {what}</h1>
              <p className="mt-1 text-sm text-brand-ink-soft leading-relaxed">
                Please try again in a moment. If it keeps happening, WhatsApp us ({SUPPORT_HOURS}) and we&apos;ll help
                directly.
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-col sm:flex-row gap-3">
            <button type="button" onClick={reset} className={btnDark}>
              <RotateCw size={16} aria-hidden />
              Try again
            </button>
            <Link href="/support" className={btnOutline}>
              Support home
            </Link>
            <WhatsAppButton message="Hi, the PRC Support page isn't loading for me." />
          </div>
        </div>
      </section>
    </SupportShell>
  );
}
