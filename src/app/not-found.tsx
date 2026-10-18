import Link from "next/link";
import { Home, ShoppingBag } from "lucide-react";
import { WhatsAppIcon } from "@/components/BrandIcons";
import { waLink } from "@/lib/config";

export const metadata = {
  title: "404 · This drift went off-road",
};

export default function NotFound() {
  return (
    <main className="min-h-[100svh] bg-brand-ink text-white flex flex-col items-center justify-center px-6 py-12 relative overflow-hidden isolate">
      {/* Subtle grid pattern background */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      {/* Red brake-light glow */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-radial pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 65%, rgba(225,29,42,0.25), transparent 70%)",
        }}
      />

      <div className="relative z-10 max-w-lg text-center">
        <p className="font-mono text-xs sm:text-sm uppercase tracking-[0.3em] text-brand-red font-bold">
          404 · off the track
        </p>
        <h1 className="font-display text-5xl sm:text-7xl font-bold mt-3 leading-[0.95]">
          This drift went <br />
          <span className="text-brand-red">off-road.</span>
        </h1>
        <p className="text-base sm:text-lg text-white/70 mt-5 leading-relaxed">
          The page you&apos;re looking for doesn&apos;t exist — maybe it was
          discontinued, maybe the URL has a typo. Either way, the garage is
          this way.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-brand-red hover:bg-brand-red-hover text-white px-6 py-4 rounded-full font-bold text-base transition-colors min-w-[200px]"
          >
            <Home size={18} />
            Back to store
          </Link>
          <Link
            href="/#hub-shop"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/15 text-white px-6 py-4 rounded-full font-semibold text-base transition-colors min-w-[200px]"
          >
            <ShoppingBag size={18} />
            Shop the lineup
          </Link>
        </div>

        <div className="mt-10 pt-6 border-t border-white/10">
          <p className="text-xs font-mono uppercase tracking-widest text-white/50">
            Looking for something specific?
          </p>
          <a
            href={waLink("Hi, I'm looking for something on pocketrccars.com but the page wasn't found.")}
            target="_blank"
            rel="noopener"
            className="mt-3 inline-flex items-center gap-2 text-sm text-white/80 hover:text-white underline-offset-4 hover:underline"
          >
            <WhatsAppIcon size={14} />
            WhatsApp us and we&apos;ll point you to it
          </a>
        </div>
      </div>
    </main>
  );
}
