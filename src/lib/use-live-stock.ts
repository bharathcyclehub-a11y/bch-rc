"use client";

import { useEffect, useState, useCallback } from "react";
import type { ProductOverride } from "@/lib/availability";

export interface LiveStockState {
  stockMap: Record<string, number> | null;
  overrideMap: Record<string, ProductOverride>;
  overridesMap: Record<string, ProductOverride>;
  loading: boolean;
  error: boolean;
  refresh: () => Promise<Record<string, number> | null>;
}

let cachedStock: Record<string, number> | null = null;
let cachedOverrides: Record<string, ProductOverride> = {};
let lastFetchedAt = 0;
let inFlightPromise: Promise<Record<string, number> | null> | null = null;
const listeners = new Set<() => void>();

const CACHE_TTL_MS = 8_000;

function notifyListeners() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // ignore listener errors
    }
  }
}

export async function fetchLiveStock(
  force = false,
): Promise<Record<string, number> | null> {
  const now = Date.now();
  if (!force && cachedStock && now - lastFetchedAt < CACHE_TTL_MS) {
    return cachedStock;
  }
  if (inFlightPromise && !force) {
    return inFlightPromise;
  }

  inFlightPromise = fetch("/api/stock", { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.ok && data.stock && typeof data.stock === "object") {
        cachedStock = data.stock as Record<string, number>;
        if (data.overrides && typeof data.overrides === "object") {
          cachedOverrides = data.overrides as Record<string, ProductOverride>;
        }
        lastFetchedAt = Date.now();
        notifyListeners();
        return cachedStock;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => {
      inFlightPromise = null;
    });

  return inFlightPromise;
}

/** Allow server-seeded initial stockMap (e.g. from SSR page props) to warm the cache. */
export function seedLiveStockCache(
  stock: Record<string, number> | null | undefined,
  overrides?: Record<string, ProductOverride>,
) {
  if (stock && typeof stock === "object") {
    cachedStock = stock;
    if (overrides) cachedOverrides = overrides;
    lastFetchedAt = Date.now();
    notifyListeners();
  }
}

export function useLiveStock(
  initialStock?: Record<string, number> | null,
): LiveStockState {
  const [stockMap, setStockMap] = useState<Record<string, number> | null>(
    () => initialStock ?? cachedStock,
  );
  const [overrideMap, setOverrideMap] = useState<Record<string, ProductOverride>>(
    () => cachedOverrides,
  );
  const [loading, setLoading] = useState<boolean>(
    () => !(initialStock ?? cachedStock),
  );
  const [error, setError] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const next = await fetchLiveStock(true);
    if (next) {
      setStockMap(next);
      setOverrideMap(cachedOverrides);
      setError(false);
    } else if (!cachedStock) {
      setError(true);
    }
    setLoading(false);
    return next;
  }, []);

  useEffect(() => {
    if (initialStock && !cachedStock) {
      seedLiveStockCache(initialStock);
    }

    const syncFromCache = () => {
      if (cachedStock) {
        setStockMap(cachedStock);
        setOverrideMap(cachedOverrides);
        setLoading(false);
        setError(false);
      }
    };

    listeners.add(syncFromCache);

    fetchLiveStock(false).then((next) => {
      if (next) {
        setStockMap(next);
        setOverrideMap(cachedOverrides);
        setError(false);
      } else if (!cachedStock && !initialStock) {
        setError(true);
      }
      setLoading(false);
    });

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchLiveStock(true);
      }
    };
    window.addEventListener("visibilitychange", onVisibility);

    return () => {
      listeners.delete(syncFromCache);
      window.removeEventListener("visibilitychange", onVisibility);
    };
  }, [initialStock]);

  return { stockMap, overrideMap, overridesMap: overrideMap, loading, error, refresh };
}
