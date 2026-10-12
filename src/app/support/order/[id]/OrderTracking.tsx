"use client";

import { useState } from "react";
import type { PublicTrackingView } from "@/lib/tracking/view";
import TrackingResult from "../../track/TrackingResult";

/**
 * Tracking block on the verified order page: the server renders the first
 * view, and Refresh re-reads the same public endpoint /support/track uses
 * (on demand only — no polling).
 */
export default function OrderTracking({ initial }: { initial: PublicTrackingView }) {
  const [view, setView] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/support/track?id=${encodeURIComponent(view.orderId)}`, { cache: "no-store" });
      if (res.status === 429) setError("Too many lookups in a short time. Please wait a minute.");
      else if (!res.ok) setError("We couldn't reach the courier update service.");
      else setView((await res.json()) as PublicTrackingView);
    } catch {
      setError("Network error. Check your connection.");
    } finally {
      setRefreshing(false);
    }
  }

  return <TrackingResult view={view} refreshing={refreshing} refreshError={error} onRefresh={refresh} />;
}
