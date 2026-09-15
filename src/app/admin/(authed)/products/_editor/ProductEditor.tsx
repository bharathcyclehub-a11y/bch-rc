"use client";

/**
 * ONE editor for creating and editing products (no duplicated forms):
 *  - "catalogue": code SKUs — price / MRP / status / badge persist through
 *    product_overrides (saveProductOverride) and live stock through the audited
 *    inventory API; code-defined content is shown locked.
 *  - "draft" / "create": admin-only DB drafts — every field editable, validated
 *    by the same schema the server action enforces.
 * Unsaved work is guarded; Save returns to the product, Save & continue stays.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { Button, ButtonLink } from "@/components/admin/Button";
import { ProductStatusBadge, Tag } from "@/components/admin/Badge";
import { Tabs } from "@/components/admin/Tabs";
import { StickyActionBar } from "@/components/admin/StickyActionBar";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { useToast } from "@/components/admin/Toast";
import { draftProductSchema, fieldErrors, priceErrors } from "@/lib/admin/product-schema";
import { saveProductOverride } from "../[id]/actions";
import { createDraftProduct, updateDraftProduct } from "../actions";
import { ProductsBackLink } from "../[id]/_components/ProductsBackLink";
import { useActiveSection, useProductForm, useUnsavedChangesGuard } from "./hooks";
import { BasicSection, EditorSection, InventorySection, OrganisationSection, PricingSection, StatusSection } from "./sections";
import { MediaEditor } from "./MediaEditor";
import { CatalogueStockEditor, DraftVariantsEditor } from "./VariantsEditor";
import { toDraftPayload, toInt, type EditorMode, type EditorValues } from "./values";

const SECTIONS = [
  { key: "basic", label: "Basic" },
  { key: "media", label: "Media" },
  { key: "pricing", label: "Pricing" },
  { key: "variants", label: "Variants" },
  { key: "status", label: "Status" },
  { key: "organisation", label: "Organisation" },
  { key: "inventory", label: "Inventory" },
];

export function ProductEditor({
  mode,
  productId,
  productName,
  initial,
  base,
  categories,
  reservedSlugs,
  lowThreshold,
  storefrontPath,
}: {
  mode: EditorMode;
  productId: string | null;
  productName: string;
  initial: EditorValues;
  /** Code catalogue values (catalogue mode) — equal values are saved as "no override". */
  base: { priceInr: number; mrpInr: number; badge: string | null } | null;
  categories: { key: string; label: string }[];
  reservedSlugs: string[];
  lowThreshold: number;
  storefrontPath: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const form = useProductForm(initial, mode === "create");
  const { values, set, errors, setErrors, changed, reset } = form;
  const [saving, setSaving] = useState<null | "save" | "continue">(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [activeSection, setActiveSection] = useActiveSection(SECTIONS.map((s) => s.key));

  const catalogue = mode === "catalogue";
  const stockChanges = catalogue ? values.variants.filter((v, i) => v.stock !== initial.variants[i]?.stock) : [];
  const overrideChanged = catalogue && (["priceInr", "mrpInr", "status", "badge"] as const).some((k) => changed.includes(k));
  const changeCount = catalogue
    ? (["priceInr", "mrpInr", "status", "badge"] as const).filter((k) => changed.includes(k)).length + stockChanges.length
    : changed.length;
  const dirty = changeCount > 0;
  const bypassRef = useUnsavedChangesGuard(dirty && saving === null);

  function focusFirst(errs: Record<string, string>) {
    const first = Object.keys(errs)[0];
    if (!first) return;
    const el = document.getElementById(`field-${first}`) ?? document.getElementById(first.split(".")[0]);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) el.focus({ preventScroll: true });
  }

  function fail(errs: Record<string, string>, message = "Check the highlighted fields") {
    setErrors(errs);
    focusFirst(errs);
    const n = Object.keys(errs).length;
    toast({ title: message, description: n ? `${n} field${n === 1 ? "" : "s"} need attention.` : undefined, tone: "error" });
  }

  function leave(to: string, refreshOnly: boolean) {
    bypassRef.current = true;
    startTransition(() => {
      if (refreshOnly) router.refresh();
      else router.push(to);
    });
  }

  async function saveCatalogue(stay: boolean) {
    if (!productId || !base) return;
    const price = toInt(values.priceInr);
    const mrp = toInt(values.mrpInr);
    const errs = priceErrors(price, mrp);
    if (Object.keys(errs).length) return fail(errs);

    setSaving(stay ? "continue" : "save");
    if (overrideChanged) {
      const res = await saveProductOverride(productId, {
        priceInr: price === base.priceInr ? null : price,
        mrpInr: mrp === base.mrpInr ? null : mrp,
        visibility: values.status as "active" | "coming" | "hidden",
        badge: values.badge === (base.badge ?? "") ? null : values.badge,
      });
      if (!res.ok) {
        setSaving(null);
        toast({ title: "Not saved", description: res.error, tone: "error" });
        return;
      }
    }
    let failed = 0;
    for (const v of stockChanges) {
      const n = toInt(v.stock);
      if (n === null) continue;
      try {
        const r = await fetch("/api/admin/inventory", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ skuId: productId, variantSlug: v.slug, mode: "set", value: n }),
        });
        if (!r.ok) failed++;
      } catch {
        failed++;
      }
    }
    setSaving(null);
    if (failed) {
      toast({ title: "Saved, with problems", description: `${failed} stock update${failed === 1 ? "" : "s"} failed — try again.`, tone: "error" });
      leave("", true);
      return;
    }
    toast({ title: "Product saved", description: productName, tone: "success" });
    leave(`/admin/products/${productId}`, stay);
  }

  async function saveDraft(stay: boolean) {
    const schema = draftProductSchema({ categoryKeys: categories.map((c) => c.key), reservedSlugs });
    const parsed = schema.safeParse(toDraftPayload(values));
    if (!parsed.success) return fail(fieldErrors(parsed.error.issues));

    setSaving(stay ? "continue" : "save");
    const res = mode === "create" ? await createDraftProduct(parsed.data) : await updateDraftProduct(productId as string, parsed.data);
    setSaving(null);
    if (!res.ok) {
      if (res.fieldErrors) fail(res.fieldErrors, res.error);
      else toast({ title: "Not saved", description: res.error, tone: "error" });
      return;
    }
    toast({ title: mode === "create" ? "Draft created" : "Draft saved", description: parsed.data.name, tone: "success" });
    if (mode === "create") {
      bypassRef.current = true;
      startTransition(() => router.replace(stay ? `/admin/products/${res.id}/edit` : `/admin/products/${res.id}`));
    } else {
      leave(`/admin/products/${res.id}`, stay);
    }
  }

  const save = (stay: boolean) => (catalogue ? saveCatalogue(stay) : saveDraft(stay));
  const cancelHref = productId ? `/admin/products/${productId}` : "/admin/products";

  return (
    <div className="pb-28">
      <PageHeader
        backLink={productId ? undefined : <ProductsBackLink />}
        back={productId ? { href: cancelHref, label: productName } : undefined}
        title={mode === "create" ? values.name.trim() || "New product" : `Edit ${productName}`}
        badges={
          <>
            <ProductStatusBadge status={values.status} />
            {dirty && <Tag>Unsaved</Tag>}
          </>
        }
        description={
          catalogue
            ? "Catalogue product · price, status, badge and stock are editable here"
            : mode === "create"
              ? "New products are saved as admin-only drafts"
              : "Admin-only draft · not on the storefront"
        }
        actions={
          storefrontPath ? (
            <ButtonLink href={storefrontPath} target="_blank" rel="noopener noreferrer" variant="ghost" icon={<ArrowUpRight size={15} aria-hidden />}>
              <span className="max-sm:sr-only">View on store</span>
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="sticky top-14 z-10 -mx-4 mb-4 bg-admin-page/95 px-4 backdrop-blur lg:hidden">
        <Tabs
          className="mx-0 px-0"
          ariaLabel="Editor sections"
          active={activeSection}
          onSelect={(k) => {
            setActiveSection(k);
            document.getElementById(k)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          items={SECTIONS.map((s) => ({ key: s.key, label: s.label }))}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0 space-y-4">
          <BasicSection form={form} readOnly={catalogue} />
          <EditorSection
            id="media"
            title="Media"
            locked={catalogue}
            description={catalogue ? "Catalogue images — managed by the dev team." : "The first image is the primary image."}
          >
            {catalogue ? (
              <CatalogueGallery images={values.images} />
            ) : (
              <MediaEditor images={values.images} onChange={(imgs) => set("images", imgs)} errors={errors} />
            )}
          </EditorSection>
          <PricingSection form={form} mode={mode} basePrice={base?.priceInr ?? null} />
          <EditorSection
            id="variants"
            title="Variants"
            description={catalogue ? "Live stock per colour — saved to inventory and logged with your name." : "Colours or versions, each with its own SKU and opening stock."}
          >
            {catalogue ? (
              <CatalogueStockEditor variants={values.variants} initial={initial.variants} onChange={(vs) => set("variants", vs)} lowThreshold={lowThreshold} />
            ) : (
              <DraftVariantsEditor variants={values.variants} onChange={(vs) => set("variants", vs)} errors={errors} />
            )}
          </EditorSection>
        </div>
        <div className="min-w-0 space-y-4">
          <StatusSection form={form} mode={mode} />
          <OrganisationSection form={form} readOnly={catalogue} categories={categories} />
          <InventorySection form={form} mode={mode} lowThreshold={lowThreshold} />
        </div>
      </div>

      <StickyActionBar
        status={
          saving ? (
            "Saving…"
          ) : dirty ? (
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="h-2 w-2 rounded-full bg-tone-warn" />
              {changeCount} unsaved change{changeCount === 1 ? "" : "s"}
            </span>
          ) : mode === "create" ? (
            "Fill in the basics, then save as a draft"
          ) : (
            "All changes saved"
          )
        }
      >
        {dirty ? (
          <Button variant="secondary" className="max-sm:flex-1" onClick={() => setDiscardOpen(true)} disabled={saving !== null}>
            Discard
          </Button>
        ) : (
          <ButtonLink href={cancelHref} variant="secondary" className="max-sm:flex-1">
            {mode === "create" ? "Cancel" : "Back to product"}
          </ButtonLink>
        )}
        {/* Save controls appear once there is something to save. */}
        {(dirty || mode === "create") && (
          <>
            <Button
              variant="secondary"
              className="max-sm:hidden"
              onClick={() => save(true)}
              loading={saving === "continue"}
              disabled={saving !== null}
            >
              Save &amp; continue
            </Button>
            <Button
              variant="primary"
              className="max-sm:flex-[2]"
              onClick={() => save(false)}
              loading={saving === "save"}
              disabled={saving !== null}
            >
              {mode === "create" ? "Save draft" : "Save"}
            </Button>
          </>
        )}
      </StickyActionBar>

      <ConfirmDialog
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        onConfirm={() => {
          reset();
          setDiscardOpen(false);
        }}
        title={`Discard ${changeCount} unsaved change${changeCount === 1 ? "" : "s"}?`}
        description="The form goes back to the last saved values."
        confirmLabel="Discard changes"
      />
    </div>
  );
}

function CatalogueGallery({ images }: { images: string[] }) {
  if (images.length === 0) return <p className="text-[13px] text-admin-muted">No images in the catalogue for this product.</p>;
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {images.slice(0, 8).map((src, i) => (
        <li key={src} className="relative aspect-square overflow-hidden rounded-lg border border-admin-line bg-admin-subtle">
          {/* eslint-disable-next-line @next/next/no-img-element -- small read-only thumbnails */}
          <img src={src} alt={`Image ${i + 1}`} loading="lazy" className="h-full w-full object-contain p-1.5" />
          {i === 0 && (
            <span className="absolute left-1.5 top-1.5 rounded bg-brand-ink px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-white">
              Primary
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
