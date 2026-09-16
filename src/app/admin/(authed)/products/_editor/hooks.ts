"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { slugify } from "@/lib/admin/product-schema";
import type { EditorValues } from "./values";

/** Form state + dirty tracking + per-field errors (keys like "variants.0.name"). */
export function useProductForm(initial: EditorValues, autoSlug: boolean) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [slugLocked, setSlugLocked] = useState(!autoSlug);

  function clear(prefix: string) {
    setErrors((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) if (k === prefix || k.startsWith(`${prefix}.`)) delete next[k];
      return next;
    });
  }

  function set<K extends keyof EditorValues>(key: K, value: EditorValues[K]) {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      // New products: the slug follows the name until the operator edits it.
      if (key === "name" && !slugLocked) next.slug = slugify(String(value));
      return next;
    });
    clear(key);
    if (key === "name" && !slugLocked) clear("slug");
    if (key === "priceInr") clear("mrpInr");
  }

  function setSlug(raw: string) {
    setSlugLocked(true);
    set("slug", raw.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-").slice(0, 80));
  }

  const changed = useMemo(
    () =>
      (Object.keys(values) as (keyof EditorValues)[]).filter(
        (k) => JSON.stringify(values[k]) !== JSON.stringify(initial[k]),
      ),
    [values, initial],
  );

  function reset() {
    setValues(initial);
    setErrors({});
  }

  return { values, set, setSlug, errors, setErrors, changed, reset };
}

export type ProductForm = ReturnType<typeof useProductForm>;

/**
 * Warns before losing unsaved work: the browser prompt on reload/close, and a
 * confirm on in-app link clicks. Set `bypass.current = true` right before a
 * programmatic navigation after a successful save.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const bypassRef = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (bypassRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (bypassRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.hash) return;
      if (!window.confirm("You have unsaved changes. Leave without saving?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
  return bypassRef;
}

/** Id of the section currently in view (drives the phone section tabs). */
export function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  const key = ids.join(",");
  useEffect(() => {
    const els = key
      .split(",")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-120px 0px -55% 0px" },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [key]);
  return [active, setActive] as const;
}
