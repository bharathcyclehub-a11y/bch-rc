"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The text field of SearchForm, searching as you type: 450 ms after the last
 * keystroke the list URL is replaced with the new `q` (from 3 characters, or
 * when cleared), so staff don't have to know to press Enter. Enter still
 * submits the surrounding GET form at once. The debounce + minimum length keep
 * it to a handful of database queries per search (free-plan egress).
 */
export function LiveSearchField({
  action,
  name,
  defaultValue,
  placeholder,
  keep,
  className,
}: {
  action: string;
  name: string;
  defaultValue: string;
  placeholder: string;
  keep: Record<string, string | undefined>;
  className: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushed = useRef(defaultValue.trim());

  // The URL changed from elsewhere (clear button, tabs, back): follow it —
  // but not for the value this field just pushed, so typing is never reset.
  useEffect(() => {
    if (defaultValue.trim() !== pushed.current) {
      pushed.current = defaultValue.trim();
      setValue(defaultValue);
    }
  }, [defaultValue]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function search(next: string) {
    const q = next.trim();
    if (q === pushed.current) return;
    pushed.current = q;
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) sp.set(k, v);
    if (q) sp.set(name, q);
    const qs = sp.toString();
    router.replace(qs ? `${action}?${qs}` : action, { scroll: false });
  }

  return (
    <input
      type="search"
      name={name}
      value={value}
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        if (timer.current) clearTimeout(timer.current);
        const len = next.trim().length;
        if (len === 0 || len >= 3) timer.current = setTimeout(() => search(next), 450);
      }}
      placeholder={placeholder}
      aria-label={placeholder}
      enterKeyHint="search"
      className={className}
    />
  );
}
