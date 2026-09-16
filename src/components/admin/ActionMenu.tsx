"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EllipsisVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./Button";
import { Dialog } from "./Dialog";
import { useToast } from "./Toast";

export type ActionItem = {
  label: string;
  icon?: ReactNode;
  href?: string;
  external?: boolean;
  onSelect?: () => void;
  /** Copies this text to the clipboard and confirms with a toast. */
  copy?: string;
  tone?: "danger";
  disabled?: boolean;
  hidden?: boolean;
};

type Position = { left: number; top?: number; bottom?: number };

/**
 * Row "⋮" menu. A fixed-position popover on desktop (portaled so table
 * overflow can't clip it); a bottom sheet with 48px rows on phones.
 */
export function ActionMenu({
  items,
  label = "More actions",
  title,
  size = "sm",
  className,
}: {
  items: ActionItem[];
  label?: string;
  /** Sheet heading on phones. */
  title?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [asSheet, setAsSheet] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const visible = items.filter((i) => !i.hidden);

  const close = useCallback(() => setOpen(false), []);

  function openMenu() {
    const sheet = window.matchMedia("(max-width: 767.98px)").matches;
    setAsSheet(sheet);
    const r = triggerRef.current?.getBoundingClientRect();
    if (!sheet && r) {
      const menuHeight = visible.length * 36 + 10;
      const flipUp = r.bottom + menuHeight + 8 > window.innerHeight && r.top > menuHeight + 8;
      setPos(flipUp ? { left: r.right, bottom: window.innerHeight - r.top + 4 } : { left: r.right, top: r.bottom + 4 });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open || asSheet) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, asSheet, close]);

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const els = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([aria-disabled=true])") ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    } else if (e.key === "Tab") {
      close();
    }
  }

  async function run(item: ActionItem) {
    close();
    if (item.copy) {
      try {
        await navigator.clipboard.writeText(item.copy);
        toast({ title: "Copied", description: item.copy, tone: "success" });
      } catch {
        toast({ title: "Couldn't copy to clipboard", tone: "error" });
      }
    }
    item.onSelect?.();
  }

  const itemClass = (it: ActionItem) =>
    cn(
      "flex w-full items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 text-left font-medium outline-none transition-colors [&_svg]:shrink-0",
      asSheet ? "h-12 text-sm" : "h-9 text-[13px]",
      it.tone === "danger"
        ? "text-tone-neg hover:bg-tone-neg-bg focus:bg-tone-neg-bg"
        : "text-brand-ink hover:bg-admin-subtle focus:bg-admin-subtle",
      it.disabled && "pointer-events-none opacity-40",
    );

  const list = visible.map((it) =>
    it.href && !it.disabled ? (
      <Link
        key={it.label}
        role="menuitem"
        href={it.href}
        target={it.external ? "_blank" : undefined}
        rel={it.external ? "noopener noreferrer" : undefined}
        onClick={close}
        className={itemClass(it)}
      >
        {it.icon}
        {it.label}
      </Link>
    ) : (
      <button
        key={it.label}
        role="menuitem"
        type="button"
        aria-disabled={it.disabled || undefined}
        onClick={() => run(it)}
        className={itemClass(it)}
      >
        {it.icon}
        {it.label}
      </button>
    ),
  );

  return (
    <>
      <IconButton
        ref={triggerRef}
        label={label}
        size={size}
        aria-haspopup="menu"
        aria-expanded={open}
        className={className}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (open) close();
          else openMenu();
        }}
      >
        <EllipsisVertical size={16} aria-hidden />
      </IconButton>

      {open && asSheet && (
        <Dialog open onClose={close} title={title ?? label} variant="sheet">
          <div role="menu" aria-label={label} className="-mx-2 -my-2 flex flex-col">
            {list}
          </div>
        </Dialog>
      )}

      {open &&
        !asSheet &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKey}
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}
            className="admin-anim-pop fixed z-50 min-w-48 -translate-x-full rounded-lg border border-admin-line bg-white p-1 shadow-[0_8px_24px_-4px_rgba(10,10,10,0.14)]"
          >
            {list}
          </div>,
          document.querySelector(".admin-shell") ?? document.body,
        )}
    </>
  );
}
