"use client";

/**
 * Products list — client-filtered (the whole catalogue is ~40 SKUs + drafts).
 * Category chips, status tabs, search, stock filter and sort all live in the
 * URL (history.replaceState — no server round trip per keystroke) and are
 * remembered for the product page's back link, so list → product → back keeps
 * the operator's place. Table (operations) and grid (merchandising) views;
 * phones get a row list with an explicit Select mode for bulk actions.
 */

import { useMemo, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  Archive,
  Boxes,
  Download,
  Eye,
  EyeOff,
  LayoutGrid,
  ListChecks,
  Plus,
  Rows3,
  SearchX,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/admin/PageHeader";
import { Button, ButtonLink } from "@/components/admin/Button";
import { Chip, ChipRow } from "@/components/admin/Chip";
import { Tabs, type TabItem } from "@/components/admin/Tabs";
import { Panel } from "@/components/admin/Panel";
import { EmptyState } from "@/components/admin/EmptyState";
import { SegmentedControl } from "@/components/admin/SegmentedControl";
import { SearchInput } from "@/components/admin/SearchForm";
import { FilterSelect, FilterSheet, type FilterDef } from "@/components/admin/Filters";
import { BulkAction, BulkActionBar } from "@/components/admin/BulkActionBar";
import type { AdminProduct } from "@/lib/admin/catalog";
import type { PermissionSet } from "@/lib/admin/permissions";
import { PRODUCT_STATUS_META, type ProductStatus } from "@/lib/admin/status";
import { ProductTable } from "./ProductTable";
import { ProductGrid } from "./ProductGrid";
import { ProductList } from "./ProductList";
import { ProductActionDialog, type ProductAction } from "./ProductActionDialog";
import { downloadProductsCsv } from "./export-csv";
import { PRODUCTS_QUERY_KEY } from "./constants";

type Category = { key: string; label: string; img: string | null };
type ViewState = { cat: string; status: string; stock: string; sort: string; view: "table" | "grid"; q: string };

const STOCK_FILTER: FilterDef = {
  key: "stock",
  label: "Stock",
  anyValue: "all",
  options: [
    { value: "all", label: "All" },
    { value: "in", label: "In stock" },
    { value: "low", label: "Low stock" },
    { value: "out", label: "Out of stock" },
    { value: "none", label: "No stock data" },
  ],
};

const SORT_FILTER: FilterDef = {
  key: "sort",
  label: "Sort",
  anyValue: "catalogue",
  options: [
    { value: "catalogue", label: "Catalogue order" },
    { value: "updated", label: "Recently updated" },
    { value: "name", label: "Name A–Z" },
    { value: "price-asc", label: "Price: low to high" },
    { value: "price-desc", label: "Price: high to low" },
    { value: "stock-asc", label: "Stock: low to high" },
    { value: "stock-desc", label: "Stock: high to low" },
  ],
};

const STATUSES = ["active", "coming", "hidden", "draft", "archived"] as const;
const DEFAULTS: ViewState = { cat: "all", status: "all", stock: "all", sort: "catalogue", view: "table", q: "" };

function readState(sp: URLSearchParams, categories: Category[]): ViewState {
  const oneOf = (v: string | null, allowed: readonly string[], fallback: string) => (v && allowed.includes(v) ? v : fallback);
  return {
    cat: oneOf(sp.get("cat"), categories.map((c) => c.key), "all"),
    status: oneOf(sp.get("status"), STATUSES, "all"),
    stock: oneOf(sp.get("stock"), STOCK_FILTER.options.map((o) => o.value), "all"),
    sort: oneOf(sp.get("sort"), SORT_FILTER.options.map((o) => o.value), "catalogue"),
    view: sp.get("view") === "grid" ? "grid" : "table",
    q: sp.get("q") ?? "",
  };
}

function toQuery(v: ViewState): string {
  const p = new URLSearchParams();
  (Object.keys(DEFAULTS) as (keyof ViewState)[]).forEach((k) => {
    if (v[k] && v[k] !== DEFAULTS[k]) p.set(k, v[k]);
  });
  return p.toString();
}

/** Live stock condition used by the Stock filter (drafts have no live stock). */
function stockMatch(p: AdminProduct, filter: string): boolean {
  if (filter === "all") return true;
  const live = p.stockKind === "live" ? p.stock : null;
  if (filter === "none") return live === null;
  if (live === null) return false;
  if (filter === "out") return live <= 0 || p.outCount > 0;
  if (filter === "low") return live > 0 && (live <= p.lowThreshold || p.lowCount > 0);
  return live > p.lowThreshold && p.outCount === 0;
}

function sortRows(list: AdminProduct[], sort: string): AdminProduct[] {
  const by = [...list];
  const stockOf = (p: AdminProduct, dir: 1 | -1) => (p.stock === null ? dir * Number.MAX_SAFE_INTEGER : p.stock);
  switch (sort) {
    case "name":
      return by.sort((a, b) => a.name.localeCompare(b.name));
    case "price-asc":
      return by.sort((a, b) => a.priceInr - b.priceInr);
    case "price-desc":
      return by.sort((a, b) => b.priceInr - a.priceInr);
    case "stock-asc":
      return by.sort((a, b) => stockOf(a, 1) - stockOf(b, 1));
    case "stock-desc":
      return by.sort((a, b) => stockOf(b, -1) - stockOf(a, -1));
    case "updated":
      return by.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    default:
      return by.sort((a, b) => a.position - b.position);
  }
}

export function ProductsView({
  products,
  categories,
  draftsAvailable,
  permissions,
}: {
  products: AdminProduct[];
  categories: Category[];
  draftsAvailable: boolean;
  permissions: PermissionSet;
}) {
  const sp = useSearchParams();
  const [state, setState] = useState<ViewState>(() => readState(new URLSearchParams(sp.toString()), categories));
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [selecting, setSelecting] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [action, setAction] = useState<ProductAction | null>(null);

  function update(patch: Partial<ViewState>) {
    const next = { ...state, ...patch };
    setState(next);
    const qs = toQuery(next);
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    try {
      sessionStorage.setItem(PRODUCTS_QUERY_KEY, qs);
    } catch {
      // Private mode / storage blocked — the back link just loses the filters.
    }
  }

  const q = state.q.trim().toLowerCase();

  // Everything except the status filter (drives the status tab counts).
  const base = useMemo(
    () =>
      products.filter(
        (p) =>
          (state.cat === "all" || p.categoryKey === state.cat) &&
          stockMatch(p, state.stock) &&
          (!q ||
            p.name.toLowerCase().includes(q) ||
            p.slug.includes(q) ||
            p.id.toLowerCase().includes(q) ||
            p.variants.some((v) => v.sku?.toLowerCase().includes(q) || v.name.toLowerCase().includes(q))),
      ),
    [products, state.cat, state.stock, q],
  );

  const rows = useMemo(
    () => sortRows(state.status === "all" ? base : base.filter((p) => p.status === state.status), state.sort),
    [base, state.status, state.sort],
  );

  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) m.set(p.categoryKey, (m.get(p.categoryKey) ?? 0) + 1);
    return m;
  }, [products]);

  const statusTabs: TabItem[] = useMemo(() => {
    const count = (s: ProductStatus) => base.filter((p) => p.status === s).length;
    const tabs: TabItem[] = [{ key: "all", label: "All", count: base.length }];
    for (const s of STATUSES) {
      const n = count(s);
      const always = s === "active" || s === "coming" || s === "hidden";
      if (always || n > 0 || state.status === s || (s === "draft" && draftsAvailable))
        tabs.push({ key: s, label: s === "draft" ? "Drafts" : PRODUCT_STATUS_META[s].label, count: n });
    }
    return tabs;
  }, [base, state.status, draftsAvailable]);

  const liveActive = products.filter((p) => p.source === "catalogue" && p.status === "active" && p.stock !== null);
  const lowCount = liveActive.filter((p) => (p.stock ?? 0) > 0 && ((p.stock ?? 0) <= p.lowThreshold || p.lowCount > 0)).length;
  const outCount = liveActive.filter((p) => (p.stock ?? 0) <= 0 || p.outCount > 0).length;

  const selectedRows = products.filter((p) => selected.has(p.id));
  const selCatalogue = selectedRows.filter((p) => p.source === "catalogue");
  const selDrafts = selectedRows.filter((p) => p.source === "draft");
  const canEdit = permissions["products.edit"];

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = (checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (checked) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  const clearSelection = () => {
    setSelected(new Set());
    setSelecting(false);
  };

  const filtersActive = state.cat !== "all" || state.status !== "all" || state.stock !== "all" || q !== "";
  const mobileFilterCount = (state.stock !== "all" ? 1 : 0) + (state.sort !== "catalogue" ? 1 : 0);
  const activeCategory = categories.find((c) => c.key === state.cat);

  return (
    <div className={cn(selectedRows.length > 0 && "pb-20")}>
      <PageHeader
        title="Products"
        description={
          <>
            {products.length} products
            {lowCount > 0 && <span className="text-tone-warn"> · {lowCount} low stock</span>}
            {outCount > 0 && <span className="text-tone-neg"> · {outCount} out of stock</span>}
          </>
        }
        actions={
          <>
            <Button
              icon={<Download size={15} aria-hidden />}
              className="max-sm:w-11 max-sm:px-0"
              onClick={() => downloadProductsCsv(selectedRows.length ? selectedRows : rows)}
            >
              <span className="max-sm:sr-only">Export</span>
            </Button>
            {permissions["products.create"] && (
              <ButtonLink href="/admin/products/new" variant="primary" className="max-sm:w-11 max-sm:px-0" icon={<Plus size={15} aria-hidden />}>
                <span className="max-sm:sr-only">Add product</span>
              </ButtonLink>
            )}
          </>
        }
      />

      <ChipRow ariaLabel="Categories" className="mb-3">
        <Chip active={state.cat === "all"} onClick={() => update({ cat: "all" })} count={products.length}>
          All
        </Chip>
        {categories.map((c) => {
          const n = catCounts.get(c.key) ?? 0;
          return (
            <Chip
              key={c.key}
              active={state.cat === c.key}
              dashed={n === 0}
              onClick={() => update({ cat: c.key })}
              count={n}
              media={
                c.img ? (
                  <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full bg-white ring-1 ring-black/5">
                    <Image src={c.img} alt="" fill sizes="28px" className="object-cover" />
                  </span>
                ) : (
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-admin-subtle text-admin-muted">
                    <Boxes size={14} aria-hidden />
                  </span>
                )
              }
            >
              {c.label}
            </Chip>
          );
        })}
      </ChipRow>

      <Tabs items={statusTabs} active={state.status} onSelect={(k) => update({ status: k })} ariaLabel="Product status" className="mb-3" />

      <div className="mb-3 flex flex-wrap items-center gap-2 md:flex-nowrap">
        <SearchInput
          value={state.q}
          onChange={(v) => update({ q: v })}
          placeholder="Search name, SKU or variant"
          className="basis-full md:max-w-sm md:basis-auto"
        />
        <div className="hidden items-center gap-2 md:flex">
          <FilterSelect label="Stock" value={state.stock} options={STOCK_FILTER.options} onChange={(v) => update({ stock: v })} />
          <FilterSelect label="Sort" value={state.sort} options={SORT_FILTER.options} onChange={(v) => update({ sort: v })} />
        </div>
        <Button className="md:hidden" icon={<SlidersHorizontal size={15} aria-hidden />} onClick={() => setSheetOpen(true)}>
          Filters
          {mobileFilterCount > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-ink px-1 text-[11px] text-white">
              {mobileFilterCount}
            </span>
          )}
        </Button>
        {canEdit && (
          <Button
            className="md:hidden"
            variant={selecting ? "primary" : "secondary"}
            icon={<ListChecks size={15} aria-hidden />}
            onClick={() => (selecting ? clearSelection() : setSelecting(true))}
          >
            {selecting ? "Done" : "Select"}
          </Button>
        )}
        <SegmentedControl
          className="ml-auto"
          ariaLabel="Layout"
          value={state.view}
          onChange={(v) => update({ view: v })}
          options={[
            { value: "table", label: "List view", icon: <Rows3 size={15} aria-hidden />, iconOnly: true },
            { value: "grid", label: "Grid view", icon: <LayoutGrid size={15} aria-hidden />, iconOnly: true },
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <Panel>
          {products.length === 0 ? (
            <EmptyState
              icon={ShoppingBag}
              title="No products yet"
              description="Products from the catalogue and drafts you create will appear here."
              action={
                permissions["products.create"] ? (
                  <ButtonLink href="/admin/products/new" variant="primary" icon={<Plus size={15} aria-hidden />}>
                    Add product
                  </ButtonLink>
                ) : undefined
              }
            />
          ) : q || state.stock !== "all" || state.status !== "all" ? (
            <EmptyState
              icon={SearchX}
              title="No products match"
              description={q ? `Nothing matches “${state.q.trim()}” with the current filters.` : "Try another status or stock filter."}
              action={
                <Button onClick={() => update({ ...DEFAULTS, view: state.view, sort: state.sort })}>Clear filters</Button>
              }
            />
          ) : (
            <EmptyState
              icon={ShoppingBag}
              title={`No products in ${activeCategory?.label ?? "this category"} yet`}
              description="Pick another category, or add a product here."
              action={
                permissions["products.create"] ? (
                  <ButtonLink href="/admin/products/new" icon={<Plus size={15} aria-hidden />}>
                    Add product
                  </ButtonLink>
                ) : undefined
              }
            />
          )}
        </Panel>
      ) : state.view === "grid" ? (
        <ProductGrid
          rows={rows}
          selected={selected}
          selecting={selecting}
          onToggle={toggle}
          permissions={permissions}
          onAction={setAction}
        />
      ) : (
        <Panel>
          <div className="hidden md:block">
            <ProductTable
              rows={rows}
              selected={selected}
              onToggle={toggle}
              onToggleAll={toggleAll}
              permissions={permissions}
              onAction={setAction}
            />
          </div>
          <div className="md:hidden">
            <ProductList rows={rows} selected={selected} selecting={selecting} onToggle={toggle} />
          </div>
        </Panel>
      )}

      {rows.length > 0 && (
        <p className="mt-3 text-xs tabular-nums text-admin-muted">
          Showing {rows.length} of {products.length} products
          {filtersActive && (
            <>
              {" · "}
              <button type="button" className="font-medium text-brand-ink underline-offset-2 hover:underline" onClick={() => update({ ...DEFAULTS, view: state.view, sort: state.sort })}>
                Clear filters
              </button>
            </>
          )}
        </p>
      )}

      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filters={[STOCK_FILTER, SORT_FILTER]}
        values={{ stock: state.stock, sort: state.sort }}
        onApply={(v) => {
          setSheetOpen(false);
          update({ stock: v.stock || "all", sort: v.sort || "catalogue" });
        }}
      />

      <BulkActionBar count={selectedRows.length} onClear={clearSelection}>
        {canEdit && selCatalogue.length > 0 && (
          <>
            <BulkAction icon={<Eye size={15} aria-hidden />} onClick={() => setAction({ kind: "visibility", visibility: "active", products: selCatalogue })}>
              Set active
            </BulkAction>
            <BulkAction icon={<Sparkles size={15} aria-hidden />} onClick={() => setAction({ kind: "visibility", visibility: "coming", products: selCatalogue })}>
              Coming soon
            </BulkAction>
            <BulkAction icon={<EyeOff size={15} aria-hidden />} onClick={() => setAction({ kind: "visibility", visibility: "hidden", products: selCatalogue })}>
              Hide
            </BulkAction>
          </>
        )}
        {canEdit && selDrafts.length > 0 && (
          <BulkAction icon={<Archive size={15} aria-hidden />} onClick={() => setAction({ kind: "draft-status", status: "archived", products: selDrafts })}>
            Archive
          </BulkAction>
        )}
        <BulkAction icon={<Download size={15} aria-hidden />} onClick={() => downloadProductsCsv(selectedRows)}>
          Export
        </BulkAction>
      </BulkActionBar>

      <ProductActionDialog action={action} onClose={() => setAction(null)} onDone={clearSelection} />
    </div>
  );
}
