"use client";

import { useState, type ReactNode } from "react";
import { Lock, Plus, X } from "lucide-react";
import { cn, formatINR } from "@/lib/utils";
import { Panel, PanelHeader } from "@/components/admin/Panel";
import { Badge, Tag } from "@/components/admin/Badge";
import { Button, IconButton } from "@/components/admin/Button";
import { Field, Input, PrefixInput, Select, Switch, Textarea } from "@/components/admin/Field";
import { MAX_HIGHLIGHTS, PRODUCT_BADGES, PRODUCT_SCALES } from "@/lib/admin/product-schema";
import { PRODUCT_STATUS_META, type ProductStatus } from "@/lib/admin/status";
import { discountPct } from "@/lib/admin/format";
import type { ProductForm } from "./hooks";
import { toInt, type EditorMode, type EditorValues } from "./values";

/** Locked catalogue content: plain text that wraps, not a disabled input. */
function ReadOnlyText({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div>
      <p className="text-[13px] font-medium text-brand-ink">{label}</p>
      <div className={cn("mt-1 break-words text-sm leading-5 text-brand-ink-soft", mono && "font-mono text-[13px]")}>{children}</div>
    </div>
  );
}

function CatalogueBasics({ values: v }: { values: EditorValues }) {
  const highlights = v.highlights.filter(Boolean);
  return (
    <EditorSection
      id="basic"
      title="Basic information"
      locked
      description="Name, copy and images come from the product catalogue — ask the dev team to change them."
    >
      <ReadOnlyText label="Product name">{v.name}</ReadOnlyText>
      <ReadOnlyText label="Product page" mono>
        /product/{v.slug}
      </ReadOnlyText>
      <ReadOnlyText label="Tagline">{v.tagline || "—"}</ReadOnlyText>
      {highlights.length > 0 && (
        <ReadOnlyText label="Highlights">
          <ul className="list-disc space-y-0.5 pl-4">
            {highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </ReadOnlyText>
      )}
    </EditorSection>
  );
}

export function EditorSection({
  id,
  title,
  description,
  locked,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  locked?: boolean;
  children: ReactNode;
}) {
  return (
    <Panel id={id} className="scroll-mt-32 lg:scroll-mt-20">
      <PanelHeader
        title={title}
        description={description}
        actions={
          locked ? (
            <Tag className="gap-1">
              <Lock size={10} aria-hidden /> Managed in catalogue
            </Tag>
          ) : undefined
        }
      />
      <div className="space-y-4 p-4 sm:p-5">{children}</div>
    </Panel>
  );
}

export function BasicSection({ form, readOnly }: { form: ProductForm; readOnly: boolean }) {
  const { values: v, set, setSlug, errors } = form;
  if (readOnly) return <CatalogueBasics values={v} />;
  return (
    <EditorSection
      id="basic"
      title="Basic information"
      locked={readOnly}
      description={readOnly ? "Name, copy and images of catalogue products live in src/lib/products.ts." : undefined}
    >
      <Field label="Product name" htmlFor="field-name" error={errors.name}>
        <Input id="field-name" value={v.name} readOnly={readOnly} invalid={!!errors.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Pocket Lamborghini Huracán" maxLength={120} />
      </Field>
      <Field label="URL slug" htmlFor="field-slug" error={errors.slug} hint={readOnly ? undefined : "Lowercase letters, numbers and dashes. Used for the product page address."}>
        <div className="flex min-w-0 items-stretch overflow-hidden rounded-lg border border-admin-line-strong bg-white focus-within:border-brand-ink focus-within:ring-2 focus-within:ring-brand-red/20">
          <span className="flex shrink-0 items-center border-r border-admin-line bg-admin-subtle px-2.5 text-xs text-admin-muted max-sm:hidden">
            pocketrccars.com/product/
          </span>
          <input
            id="field-slug"
            value={v.slug}
            readOnly={readOnly}
            aria-invalid={!!errors.slug || undefined}
            onChange={(e) => setSlug(e.target.value)}
            className="h-9 min-w-0 flex-1 bg-transparent px-3 font-mono text-[13px] text-brand-ink focus:outline-none read-only:bg-admin-subtle/60 max-md:h-11"
          />
        </div>
      </Field>
      <Field label="Tagline" htmlFor="field-tagline" optional={!readOnly} error={errors.tagline} hint={readOnly ? undefined : `${v.tagline.length}/140 · one line under the name`}>
        <Input id="field-tagline" value={v.tagline} readOnly={readOnly} maxLength={140} onChange={(e) => set("tagline", e.target.value)} placeholder="e.g. V10 wedge silhouette · 2.4 GHz · LED headlights" />
      </Field>
      <Field label="Highlights" hint={readOnly ? undefined : `Up to ${MAX_HIGHLIGHTS} short bullet points`}>
        <ul className="space-y-2">
          {v.highlights.map((h, i) => (
            <li key={i} className="flex items-center gap-2">
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-admin-line-strong" />
              <Input
                value={h}
                readOnly={readOnly}
                maxLength={120}
                aria-label={`Highlight ${i + 1}`}
                onChange={(e) => set("highlights", v.highlights.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {!readOnly && v.highlights.length > 1 && (
                <IconButton label={`Remove highlight ${i + 1}`} size="sm" onClick={() => set("highlights", v.highlights.filter((_, j) => j !== i))}>
                  <X size={14} aria-hidden />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
        {!readOnly && v.highlights.length < MAX_HIGHLIGHTS && (
          <Button size="sm" variant="ghost" icon={<Plus size={14} aria-hidden />} onClick={() => set("highlights", [...v.highlights, ""])}>
            Add highlight
          </Button>
        )}
      </Field>
      {!readOnly && (
        <Field label="Description" htmlFor="field-description" optional error={errors.description}>
          <Textarea id="field-description" value={v.description} rows={5} maxLength={4000} onChange={(e) => set("description", e.target.value)} placeholder="What's in the box, how it drives, who it's for…" />
        </Field>
      )}
    </EditorSection>
  );
}

export function PricingSection({
  form,
  mode,
  basePrice,
}: {
  form: ProductForm;
  mode: EditorMode;
  basePrice: number | null;
}) {
  const { values: v, set, errors } = form;
  const price = toInt(v.priceInr);
  const mrp = toInt(v.mrpInr);
  const cost = toInt(v.costInr);
  const off = price !== null && mrp !== null ? discountPct(mrp, price) : 0;
  const draft = mode !== "catalogue";
  const digits = (s: string) => s.replace(/[^\d]/g, "");
  return (
    <EditorSection
      id="pricing"
      title="Pricing"
      description={draft ? "Prices include GST." : "Changing the price updates the product page and checkout immediately."}
    >
      <div className={cn("grid gap-4", draft ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        <Field label="Selling price" htmlFor="field-priceInr" error={errors.priceInr}>
          <PrefixInput id="field-priceInr" value={v.priceInr} invalid={!!errors.priceInr} onChange={(e) => set("priceInr", digits(e.target.value))} placeholder="0" />
        </Field>
        <Field label="MRP / compare-at" htmlFor="field-mrpInr" error={errors.mrpInr}>
          <PrefixInput id="field-mrpInr" value={v.mrpInr} invalid={!!errors.mrpInr} onChange={(e) => set("mrpInr", digits(e.target.value))} placeholder="0" />
        </Field>
        {draft && (
          <Field label="Cost per item" htmlFor="field-costInr" optional error={errors.costInr}>
            <PrefixInput id="field-costInr" value={v.costInr} onChange={(e) => set("costInr", digits(e.target.value))} placeholder="0" />
          </Field>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-admin-muted">
        {off > 0 && price !== null && mrp !== null && (
          <Badge tone="positive" dot={false}>
            {off}% off · customers save {formatINR(mrp - price)}
          </Badge>
        )}
        {draft && cost !== null && price !== null && price > 0 && (
          <span>
            Margin <b className="font-semibold text-brand-ink">{formatINR(price - cost)}</b> ({Math.round(((price - cost) / price) * 100)}%)
          </span>
        )}
        {!draft && basePrice !== null && price !== basePrice && <span>Catalogue price {formatINR(basePrice)}</span>}
      </div>
    </EditorSection>
  );
}

const CATALOGUE_STATUSES: ProductStatus[] = ["active", "coming", "hidden"];
const DRAFT_STATUSES: ProductStatus[] = ["draft", "archived"];

export function StatusSection({ form, mode }: { form: ProductForm; mode: EditorMode }) {
  const { values: v, set } = form;
  const options = mode === "catalogue" ? CATALOGUE_STATUSES : DRAFT_STATUSES;
  return (
    <EditorSection id="status" title="Status">
      <fieldset className="space-y-2">
        <legend className="sr-only">Product status</legend>
        {options.map((s) => {
          const meta = PRODUCT_STATUS_META[s];
          const selected = v.status === s;
          return (
            <label
              key={s}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                selected ? "border-brand-ink ring-1 ring-brand-ink" : "border-admin-line hover:border-admin-line-strong",
              )}
            >
              <input
                type="radio"
                name="product-status"
                checked={selected}
                onChange={() => set("status", s)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-brand-ink"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-brand-ink">{meta.label}</span>
                <span className="block text-xs text-admin-muted">{meta.hint}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <p className="text-xs leading-4 text-admin-muted">
        {mode === "catalogue"
          ? "Catalogue products can't be deleted — hide them to take them off the storefront. Nothing is lost."
          : "Admin-created products stay off the storefront until publishing is released. Archive drafts you no longer need."}
      </p>
    </EditorSection>
  );
}

export function OrganisationSection({
  form,
  readOnly,
  categories,
}: {
  form: ProductForm;
  readOnly: boolean;
  categories: { key: string; label: string }[];
}) {
  const { values: v, set, errors } = form;
  return (
    <EditorSection id="organisation" title="Organisation">
      {readOnly ? (
        <>
          <ReadOnlyText label="Category">{categories.find((c) => c.key === v.category)?.label ?? v.category}</ReadOnlyText>
          <ReadOnlyText label="Scale">{v.scale}</ReadOnlyText>
        </>
      ) : (
        <>
          <Field label="Category" htmlFor="field-category" error={errors.category}>
            <Select id="field-category" value={v.category} invalid={!!errors.category} onChange={(e) => set("category", e.target.value)}>
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Scale" htmlFor="field-scale" error={errors.scale}>
            <Select id="field-scale" value={v.scale} onChange={(e) => set("scale", e.target.value)}>
              {PRODUCT_SCALES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
      <Field label="Store badge" htmlFor="field-badge" hint="Shown on the product tile">
        <Select id="field-badge" value={v.badge} onChange={(e) => set("badge", e.target.value)}>
          <option value="">No badge</option>
          {PRODUCT_BADGES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </Select>
      </Field>
      {!readOnly && <TagsField tags={v.tags} onChange={(t) => set("tags", t)} />}
      {readOnly && <p className="text-xs text-admin-muted">Category and scale are managed in the product catalogue.</p>}
    </EditorSection>
  );
}

function TagsField({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim().toLowerCase().replace(/,/g, "").slice(0, 24);
    if (t && !tags.includes(t) && tags.length < 10) onChange([...tags, t]);
    setDraft("");
  };
  return (
    <Field label="Tags" optional hint="Press Enter to add · up to 10">
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-admin-line-strong bg-white p-1.5 focus-within:border-brand-ink focus-within:ring-2 focus-within:ring-brand-red/20">
        {tags.map((t) => (
          <span key={t} className="inline-flex h-7 items-center gap-1 rounded-md bg-admin-subtle pl-2 pr-1 text-xs font-medium text-brand-ink">
            {t}
            <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Remove tag ${t}`} className="grid h-5 w-5 place-items-center rounded text-admin-muted hover:bg-white hover:text-brand-ink">
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !draft && tags.length) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={add}
          aria-label="Add tag"
          placeholder={tags.length ? "" : "e.g. drift, gift"}
          className="h-7 min-w-24 flex-1 bg-transparent px-1 text-sm focus:outline-none"
        />
      </div>
    </Field>
  );
}

export function InventorySection({ form, mode, lowThreshold }: { form: ProductForm; mode: EditorMode; lowThreshold: number }) {
  const { values: v, set, errors } = form;
  if (mode === "catalogue")
    return (
      <EditorSection id="inventory" title="Inventory">
        <p className="text-[13px] text-brand-ink-soft">
          Stock is tracked per variant in the live inventory table — edit counts in <b className="font-semibold">Variants</b>. Orders
          reserve units at checkout and release them automatically if unpaid.
        </p>
        <p className="text-xs text-admin-muted">Low-stock alert at {lowThreshold} units (store-wide setting).</p>
      </EditorSection>
    );
  return (
    <EditorSection id="inventory" title="Inventory">
      <Switch
        checked={v.trackInventory}
        onChange={(c) => set("trackInventory", c)}
        label="Track inventory"
        description="Stop selling a variant when it reaches 0"
      />
      <Field label="Low-stock alert at" htmlFor="field-lowStockThreshold" error={errors.lowStockThreshold} hint="Units per variant">
        <Input
          id="field-lowStockThreshold"
          inputMode="numeric"
          value={v.lowStockThreshold}
          onChange={(e) => set("lowStockThreshold", e.target.value.replace(/[^\d]/g, ""))}
          className="w-28"
        />
      </Field>
    </EditorSection>
  );
}
