"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Package, Plus, Search, ShoppingBag, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/admin/Dialog";
import { ADMIN_NAV_ITEMS } from "./nav";

type Command = { key: string; label: string; group: string; href: string; icon: LucideIcon };

/**
 * ⌘K / Ctrl K palette: jump to any admin page, start a manual order or a new
 * product, or hand the typed text to the Orders / Products / Customers search.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Search and jump"
      hideHeader
      placement="top"
      size="lg"
      bodyClassName="p-0 sm:p-0"
    >
      <PaletteBody onClose={onClose} />
    </Dialog>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const query = q.trim();

  const commands = useMemo<Command[]>(() => {
    const needle = query.toLowerCase();
    const match = (label: string) => !needle || label.toLowerCase().includes(needle);
    const enc = encodeURIComponent(query);
    const search: Command[] = query
      ? [
          { key: "s-orders", label: `Orders matching “${query}”`, group: "Search", href: `/admin/orders?view=all&q=${enc}`, icon: Package },
          { key: "s-products", label: `Products matching “${query}”`, group: "Search", href: `/admin/products?q=${enc}`, icon: ShoppingBag },
          { key: "s-customers", label: `Customers matching “${query}”`, group: "Search", href: `/admin/customers?q=${enc}`, icon: Users },
        ]
      : [];
    const actions: Command[] = [
      { key: "a-order", label: "New manual order", group: "Create", href: "/admin/orders/new", icon: Plus },
      { key: "a-product", label: "Add product", group: "Create", href: "/admin/products/new", icon: Plus },
    ].filter((c) => match(c.label));
    const pages: Command[] = ADMIN_NAV_ITEMS.filter((i) => match(i.label)).map((i) => ({
      key: i.href,
      label: i.label,
      group: "Go to",
      href: i.href,
      icon: i.icon,
    }));
    return [...search, ...actions, ...pages];
  }, [query]);

  const active = Math.min(cursor, Math.max(0, commands.length - 1));

  function go(c: Command | undefined) {
    if (!c) return;
    onClose();
    router.push(c.href);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((active + 1) % Math.max(1, commands.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((active - 1 + commands.length) % Math.max(1, commands.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(commands[active]);
    }
  }

  let lastGroup = "";
  return (
    <div className="flex max-h-[min(70dvh,520px)] flex-col">
      <div className="flex items-center gap-2.5 border-b border-admin-line px-4">
        <Search size={17} aria-hidden className="shrink-0 text-admin-muted" />
        <input
          data-autofocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onKey}
          placeholder="Search orders, products, customers or jump to a page…"
          aria-label="Search or jump to"
          role="combobox"
          aria-expanded="true"
          aria-controls="admin-palette-list"
          aria-activedescendant={commands[active] ? `cmd-${commands[active].key}` : undefined}
          className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-brand-ink placeholder:text-admin-muted focus:outline-none"
        />
      </div>
      <ul id="admin-palette-list" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-2">
        {commands.length === 0 && <li className="px-3 py-8 text-center text-[13px] text-admin-muted">No matches.</li>}
        {commands.map((c, i) => {
          const header = c.group !== lastGroup ? c.group : null;
          lastGroup = c.group;
          const Icon = c.icon;
          return (
            <li key={c.key} role="presentation">
              {header && (
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">{header}</p>
              )}
              <button
                id={`cmd-${c.key}`}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setCursor(i)}
                onClick={() => go(c)}
                className={cn(
                  "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] font-medium max-md:h-12 max-md:text-sm",
                  i === active ? "bg-admin-subtle text-brand-ink" : "text-brand-ink-soft",
                )}
              >
                <Icon size={16} aria-hidden className="shrink-0 text-admin-muted" />
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {i === active && <CornerDownLeft size={14} aria-hidden className="shrink-0 text-admin-muted" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
