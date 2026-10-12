"use client";

import { motion } from "framer-motion";
import {
  Gift,
  CreditCard,
  Package,
  Zap,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { OFFERS, bundleDiscountPct } from "@/lib/config";
import { getHeroSku } from "@/lib/products";
import { formatINR } from "@/lib/utils";

const HERO_RETAIL = getHeroSku().retailINR;

type Offer = {
  icon: LucideIcon;
  title: string;
  sub: string;
  /** Honest, operational reason-why ("because…"). Triggers the reason-why
   *  heuristic - a stated cause raises believability of the freebie even
   *  when the cause is mundane. Optional - shows under the sub if present. */
  because?: string;
};

const OFFERS_LIST: Offer[] = [
  {
    icon: Gift,
    title: "Free drift wheels",
    sub: "Worth ₹199",
  },
  {
    icon: CreditCard,
    title: `Pay online → ₹${OFFERS.prepaidDiscountINR} off`,
    sub: `${formatINR(HERO_RETAIL - OFFERS.prepaidDiscountINR)} + 24-hr dispatch`,
  },
  {
    icon: Package,
    title: "Mix 2 cars",
    sub: `Auto-save ${bundleDiscountPct(2)}%`,
  },
  {
    icon: Zap,
    title: "Festival drop",
    sub: "Launch price",
  },
  {
    icon: Sparkles,
    title: `LED +${formatINR(OFFERS.ledSmokeUpgradeINR)}`,
    sub: "Full-body LED",
  },
];

export default function OfferStack() {
  return (
    <section className="py-5 sm:py-10 bg-brand-cream">
      <div className="max-w-5xl mx-auto px-4">
        <div className="text-center">
          <p className="text-[10px] sm:text-xs font-mono font-bold uppercase tracking-widest text-brand-red">
            Stack &apos;em up
          </p>
          <h2 className="text-xl sm:text-2xl font-bold text-brand-ink mt-1">
            Five offers. One cart.
          </h2>
        </div>

        {/* Mobile: horizontal snap-scroll. Desktop: 3/5 col grid. */}
        <div className="mt-6 sm:mt-8 -mx-4 sm:mx-0 overflow-x-auto overflow-y-hidden sm:overflow-visible snap-x snap-mandatory sm:snap-none no-scrollbar">
          <div className="flex sm:grid sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 px-4 sm:px-0 pb-2 sm:pb-0">
            {OFFERS_LIST.map((offer, i) => {
              const Icon = offer.icon;
              return (
                <motion.div
                  key={offer.title}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.35, delay: i * 0.06, ease: "easeOut" }}
                  className="snap-center shrink-0 w-[72%] sm:w-auto bg-white rounded-xl border border-brand-line p-4 sm:p-5 hover:border-brand-red hover:shadow-md transition-all"
                >
                  <div className="w-11 h-11 rounded-lg bg-brand-red-soft text-brand-red flex items-center justify-center mb-3">
                    <Icon size={20} aria-hidden />
                  </div>
                  <div className="font-semibold text-brand-ink text-base leading-tight">
                    {offer.title}
                  </div>
                  <div className="text-sm text-brand-ink-soft mt-1.5 leading-snug">
                    {offer.sub}
                  </div>
                  {offer.because && (
                    <div className="text-[11px] text-brand-ink-soft/80 mt-2 italic leading-snug">
                      {offer.because}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
