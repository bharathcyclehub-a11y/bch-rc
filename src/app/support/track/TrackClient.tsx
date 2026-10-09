"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, RotateCw, Search, SearchX, WifiOff } from "lucide-react";
import type { PublicTrackingView } from "@/lib/tracking/view";
import { Skeleton } from "@/components/Skeleton";
import { WhatsAppIcon } from "@/components/BrandIcons";
import { waLink } from "@/lib/config";
import TrackingResult from "./TrackingResult";

const ORDER_ID_RE = /^PRC-[A-Z0-9]{4,12}$/;
const EMPTY_ERROR = "Enter an order ID to track.";
const FORMAT_ERROR = "Order IDs look like PRC-XXXXXXXX (the format on your WhatsApp confirmation).";

export type LookupError = "not_found" | "network" | "server" | "rate_limited";
type LookupResult = { ok: true; view: PublicTrackingView } | { ok: false; error: LookupError };

type State =
  | { phase: "idle" }
  | { phase: "loading"; id: string }
  | { phase: "error"; id: string; error: LookupError }
  | { phase: "ready"; id: string; view: PublicTrackingView; refreshing: boolean; refreshError: LookupError | null };

export const ERROR_COPY: Record<LookupError, string> = {
  not_found: "No order found with that ID. Double-check the WhatsApp confirmation.",
  network: "Network error. Check your connection and retry.",
  server: "Couldn't fetch your order. Try again or WhatsApp us.",
  rate_limited: "Too many lookups in a short time. Please wait a minute and try again.",
};

const normalise = (raw: string | null) => (raw ?? "").trim().toUpperCase();

async function lookup(id: string): Promise<LookupResult> {
  try {
    const res = await fetch(`/api/support/track?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (res.status === 404) return { ok: false, error: "not_found" };
    if (res.status === 429) return { ok: false, error: "rate_limited" };
    if (!res.ok) return { ok: false, error: "server" };
    return { ok: true, view: (await res.json()) as PublicTrackingView };
  } catch {
    return { ok: false, error: "network" };
  }
}

const inputClass =
  "w-full min-h-12 pl-11 pr-4 py-3 sm:py-4 rounded-xl border-2 border-brand-line focus:border-brand-red focus:outline-none text-brand-ink placeholder:text-brand-ink-soft/50 font-mono text-base uppercase tracking-widest";
const submitClass =
  "min-h-12 bg-brand-red hover:bg-brand-red-hover disabled:opacity-50 text-white px-6 py-3 sm:py-4 rounded-xl font-bold text-base transition-colors";

/** Static stand-in while useSearchParams resolves on the client. */
export function TrackFormFallback() {
  return (
    <div className="mt-6 flex flex-col sm:flex-row gap-3" aria-hidden>
      <div className="relative flex-1">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-ink-soft" />
        <div className={`${inputClass} text-brand-ink-soft/50 flex items-center`}>PRC-A1B2C3D4</div>
      </div>
      <div className={`${submitClass} text-center`}>Track</div>
    </div>
  );
}

export default function TrackClient() {
  const searchParams = useSearchParams();
  const urlId = normalise(searchParams.get("id"));
  const urlIdValid = ORDER_ID_RE.test(urlId);

  const [input, setInput] = useState(urlId);
  const [formError, setFormError] = useState<string | null>(urlId && !urlIdValid ? FORMAT_ERROR : null);
  const [state, setState] = useState<State>(() => (urlIdValid ? { phase: "loading", id: urlId } : { phase: "idle" }));

  // ?id= changed under us (e.g. a link to another order while on this page):
  // show that order loading straight away — the effect below fetches it.
  const [seenUrlId, setSeenUrlId] = useState(urlId);
  if (urlId !== seenUrlId) {
    setSeenUrlId(urlId);
    if (urlIdValid && !(state.phase !== "idle" && state.id === urlId)) {
      setInput(urlId);
      setFormError(null);
      setState({ phase: "loading", id: urlId });
    }
  }

  // Latest request wins; `requested` stops the URL sync (and StrictMode's
  // double effect) from turning one lookup into two fetches.
  const seq = useRef(0);
  const requested = useRef<string | null>(null);

  const run = useCallback(async (id: string, mode: "lookup" | "refresh") => {
    const mine = ++seq.current;
    const result = await lookup(id);
    if (mine !== seq.current) return;
    setState((prev) => {
      if (result.ok) return { phase: "ready", id, view: result.view, refreshing: false, refreshError: null };
      if (mode === "refresh" && prev.phase === "ready" && prev.id === id && result.error !== "not_found") {
        return { ...prev, refreshing: false, refreshError: result.error };
      }
      return { phase: "error", id, error: result.error };
    });
  }, []);

  useEffect(() => {
    if (!urlIdValid || requested.current === urlId) return;
    requested.current = urlId;
    void run(urlId, "lookup");
  }, [urlId, urlIdValid, run]);

  function startLookup(id: string) {
    requested.current = id;
    setFormError(null);
    setState({ phase: "loading", id });
    if (urlId !== id) {
      // Keep the URL shareable / reload-safe without adding a history entry.
      window.history.replaceState(null, "", `?id=${encodeURIComponent(id)}`);
    }
    void run(id, "lookup");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = normalise(input);
    if (!id) {
      setFormError(EMPTY_ERROR);
    } else if (!ORDER_ID_RE.test(id)) {
      setFormError(FORMAT_ERROR);
    } else {
      startLookup(id);
    }
  }

  function handleRefresh() {
    if (state.phase !== "ready" || state.refreshing) return;
    setState({ ...state, refreshing: true, refreshError: null });
    void run(state.id, "refresh");
  }

  const busy = state.phase === "loading";
  const announcement =
    state.phase === "loading"
      ? `Looking up order ${state.id}…`
      : state.phase === "error"
        ? ERROR_COPY[state.error]
        : state.phase === "ready"
          ? state.refreshing
            ? "Refreshing…"
            : `Order ${state.id}: ${state.view.headline.label}`
          : "";

  return (
    <>
      <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <label htmlFor="track-order-id" className="sr-only">
            Order ID
          </label>
          <Search
            size={18}
            aria-hidden
            className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-ink-soft pointer-events-none"
          />
          <input
            id="track-order-id"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="PRC-A1B2C3D4"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="search"
            aria-invalid={formError ? true : undefined}
            aria-describedby={formError ? "track-order-id-error" : undefined}
            className={inputClass}
          />
        </div>
        <button type="submit" disabled={busy} className={submitClass}>
          {busy ? "Searching…" : "Track"}
        </button>
      </form>

      {formError && (
        <p id="track-order-id-error" className="mt-3 flex items-start gap-1.5 text-sm text-brand-red font-medium">
          <AlertCircle size={16} aria-hidden className="mt-0.5 shrink-0" />
          {formError}
        </p>
      )}

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {state.phase === "loading" && <ResultSkeleton />}

      {state.phase === "error" && (
        <LookupErrorCard id={state.id} error={state.error} onRetry={() => startLookup(state.id)} />
      )}

      {state.phase === "ready" && (
        <TrackingResult
          view={state.view}
          refreshing={state.refreshing}
          refreshError={state.refreshError ? ERROR_COPY[state.refreshError] : null}
          onRefresh={handleRefresh}
        />
      )}
    </>
  );
}

function ResultSkeleton() {
  return (
    <div className="mt-8 space-y-4" aria-busy="true">
      <div className="rounded-2xl border border-brand-line bg-brand-cream p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-36" />
          </div>
          <Skeleton className="h-7 w-24 rounded-full" />
        </div>
        <div className="flex justify-between gap-2 pt-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-6 rounded-full" />
          ))}
        </div>
        <div className="space-y-3 border-t border-brand-line pt-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex justify-between gap-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-brand-line p-4 sm:p-6 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    </div>
  );
}

function LookupErrorCard({ id, error, onRetry }: { id: string; error: LookupError; onRetry: () => void }) {
  const Icon = error === "not_found" ? SearchX : error === "network" ? WifiOff : AlertCircle;
  const title =
    error === "not_found"
      ? `We couldn't find order ${id}`
      : error === "rate_limited"
        ? "Please wait a moment"
        : "We couldn't load this order";
  return (
    <div className="mt-8 rounded-2xl border border-brand-line bg-brand-cream p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <Icon size={22} aria-hidden className="mt-0.5 shrink-0 text-brand-red" />
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold text-brand-ink break-words">{title}</h2>
          <p className="mt-1 text-sm text-brand-ink-soft leading-relaxed">{ERROR_COPY[error]}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-col sm:flex-row gap-3">
        {error !== "not_found" && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-12 inline-flex items-center justify-center gap-2 rounded-xl bg-brand-ink px-5 font-semibold text-sm text-white hover:bg-brand-ink-soft transition-colors"
          >
            <RotateCw size={16} aria-hidden />
            Try again
          </button>
        )}
        <a
          href={waLink(
            error === "not_found"
              ? `Hi, I can't find my order ${id} on the tracking page.`
              : `Hi, I need an update on my order ${id}.`,
          )}
          target="_blank"
          rel="noopener"
          className="min-h-12 inline-flex items-center justify-center gap-2 rounded-full border border-tone-pos/30 bg-tone-pos-bg px-5 font-semibold text-sm text-tone-pos hover:bg-tone-pos/10 transition-colors"
        >
          <WhatsAppIcon size={18} aria-hidden />
          WhatsApp us
          <span className="sr-only">(opens WhatsApp)</span>
        </a>
      </div>
    </div>
  );
}
