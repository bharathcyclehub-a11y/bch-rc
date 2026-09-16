import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowUpRight, ImageOff, Info, Pencil } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { formatINR } from "@/lib/utils";
import {
  loadProductActivity,
  loadProductDetail,
  loadProductSales,
  type ProductDetail,
} from "@/lib/admin/catalog";
import { permissionsFor } from "@/lib/admin/permissions";
import { PRODUCT_STATUS_META } from "@/lib/admin/status";
import { discountPct, formatDateShort, formatRelative, requestTime } from "@/lib/admin/format";
import { PageHeader } from "@/components/admin/PageHeader";
import { ButtonLink } from "@/components/admin/Button";
import { ProductStatusBadge, Tag } from "@/components/admin/Badge";
import { Tabs } from "@/components/admin/Tabs";
import { KeyValue, Panel, PanelHeader } from "@/components/admin/Panel";
import { Metric } from "@/components/admin/Metric";
import { EmptyState } from "@/components/admin/EmptyState";
import { PRODUCT_TABS, type ProductTab } from "../constants";
import { ProductThumb } from "../product-ui";
import { ProductsBackLink } from "./_components/ProductsBackLink";
import { ProductHeaderActions } from "./_components/ProductHeaderActions";
import { VariantStock } from "./_components/VariantStock";
import { ActivityTimeline } from "./_components/ActivityTimeline";

export const dynamic = "force-dynamic";

/**
 * Product control centre: overview metrics (price, stock, 30-day paid sales),
 * variants with in-place stock adjustment, media, and the audit trail. Editing
 * content/pricing happens in /admin/products/[id]/edit.
 */
export default async function ProductControlCentre({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const ctx = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const product = await loadProductDetail(decodeURIComponent(id), ctx.siteIds);
  if (!product) notFound();

  const rawTab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: ProductTab = (PRODUCT_TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as ProductTab) : "overview";
  const permissions = permissionsFor(ctx.role);
  const now = requestTime();

  const [sales, activity] = await Promise.all([
    product.source === "catalogue" ? loadProductSales(product.id, ctx.siteIds, 30) : Promise.resolve(null),
    loadProductActivity(product, ctx.siteIds, tab === "activity" ? 50 : 6),
  ]);

  const base = `/admin/products/${encodeURIComponent(product.id)}`;
  const tabHref = (t: ProductTab) => (t === "overview" ? base : `${base}?tab=${t}`);
  const liveStock = product.stockKind === "live";
  const meta = [
    product.categoryLabel,
    product.categoryLabel.includes(product.scale) ? null : product.scale,
    `SKU ${product.source === "draft" ? product.slug : product.id}`,
    product.updatedAt
      ? `Updated ${formatRelative(product.updatedAt, now).toLowerCase()}${product.updatedBy ? ` by ${product.updatedBy.split("@")[0]}` : ""}`
      : null,
  ].filter(Boolean);

  return (
    <div>
      <PageHeader
        backLink={<ProductsBackLink />}
        media={<ProductThumb src={product.image} alt="" className="h-14 w-14 rounded-lg" sizes="56px" />}
        title={product.name}
        badges={
          <>
            <ProductStatusBadge status={product.status} />
            {product.overridden && <Tag>Edited in admin</Tag>}
            {product.internal && <Tag>Internal</Tag>}
          </>
        }
        description={meta.join(" · ")}
        actions={
          <>
            {product.storefrontPath && (
              <ButtonLink
                href={product.storefrontPath}
                target="_blank"
                rel="noopener noreferrer"
                variant="ghost"
                className="max-md:hidden"
                icon={<ArrowUpRight size={15} aria-hidden />}
              >
                View on store
              </ButtonLink>
            )}
            <ProductHeaderActions product={product} permissions={permissions} />
            {permissions["products.edit"] && (
              <ButtonLink href={`${base}/edit`} variant="primary" icon={<Pencil size={14} aria-hidden />}>
                Edit product
              </ButtonLink>
            )}
          </>
        }
      />

      {product.source === "draft" && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-tone-info/20 bg-tone-info-bg px-4 py-3 text-[13px] text-tone-info">
          <Info size={16} aria-hidden className="mt-0.5 shrink-0" />
          <p>
            <b className="font-semibold">Admin-only {product.status === "archived" ? "archived draft" : "draft"}.</b>{" "}
            Not on the storefront or at checkout until product publishing is released.
          </p>
        </div>
      )}

      <Tabs
        ariaLabel="Product sections"
        active={tab}
        className="mb-4 md:mb-5"
        items={[
          { key: "overview", label: "Overview", href: tabHref("overview") },
          { key: "variants", label: "Variants", count: product.variants.length, href: tabHref("variants") },
          { key: "inventory", label: liveStock ? "Inventory" : "Opening stock", count: product.stock ?? null, href: tabHref("inventory") },
          { key: "media", label: "Media", count: product.images.length, href: tabHref("media") },
          { key: "activity", label: "Activity", href: tabHref("activity") },
        ]}
      />

      {tab === "overview" && <Overview product={product} sales={sales} activity={activity} now={now} canAdjust={permissions["inventory.adjust"]} activityHref={tabHref("activity")} />}

      {(tab === "variants" || tab === "inventory") && (
        <div className="space-y-4">
          <Panel>
            <PanelHeader
              title={tab === "variants" ? "Variants" : liveStock ? "Stock by variant" : "Opening stock by variant"}
              description={
                liveStock
                  ? `Live from inventory · low-stock alert at ${product.lowThreshold} units`
                  : "Planned stock — applied to inventory when the product is published"
              }
            />
            <VariantStock
              productId={product.id}
              productName={product.name}
              source={product.source}
              variants={product.variants}
              lowThreshold={product.lowThreshold}
              canAdjust={permissions["inventory.adjust"]}
            />
          </Panel>
          {tab === "inventory" && (
            <Panel>
              <PanelHeader title="Stock history" />
              <ActivityTimeline
                items={activity.filter((a) => a.title.startsWith("Stock"))}
                now={now}
                emptyText="Manual stock changes will be listed here."
              />
            </Panel>
          )}
        </div>
      )}

      {tab === "media" && <Media product={product} editHref={`${base}/edit#media`} canEdit={permissions["products.edit"]} />}

      {tab === "activity" && (
        <Panel>
          <PanelHeader title="Activity" description="Price, status, badge and stock changes made in the admin" />
          <ActivityTimeline items={activity} now={now} emptyText="Changes made in the admin will be listed here." />
        </Panel>
      )}
    </div>
  );
}

function Overview({
  product,
  sales,
  activity,
  now,
  canAdjust,
  activityHref,
}: {
  product: ProductDetail;
  sales: { units: number; revenue: number } | null;
  activity: Awaited<ReturnType<typeof loadProductActivity>>;
  now: number;
  canAdjust: boolean;
  activityHref: string;
}) {
  const off = discountPct(product.mrpInr, product.priceInr);
  const live = product.stockKind === "live";
  const alerts = [product.lowCount && `${product.lowCount} low`, product.outCount && `${product.outCount} out`].filter(Boolean);
  const priceSource = product.source === "draft" ? "Draft" : product.base && product.base.priceInr !== product.priceInr ? "Admin override" : "Catalogue";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          label="Price"
          value={formatINR(product.priceInr)}
          hint={product.mrpInr > product.priceInr ? `MRP ${formatINR(product.mrpInr)} · ${off}% off` : "No MRP discount"}
        />
        <Metric
          label={live ? "Total stock" : "Opening stock"}
          value={product.stock === null ? "—" : `${product.stock.toLocaleString("en-IN")} units`}
          hint={`${product.variants.length} variant${product.variants.length === 1 ? "" : "s"}${alerts.length ? ` · ${alerts.join(" · ")}` : ""}`}
          hintTone={product.outCount ? "negative" : product.lowCount ? "attention" : undefined}
        />
        <Metric
          label="Sold · 30 days"
          value={sales ? `${sales.units.toLocaleString("en-IN")} units` : "—"}
          hint={product.source === "draft" ? "Not on sale yet" : "Paid orders only"}
        />
        <Metric
          label="Revenue · 30 days"
          value={sales ? formatINR(sales.revenue) : "—"}
          hint={product.source === "draft" ? "Not on sale yet" : "Paid orders only"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Panel>
            <PanelHeader title="Variants & stock" description={live ? `Low-stock alert at ${product.lowThreshold} units` : "Planned opening stock"} />
            <VariantStock
              productId={product.id}
              productName={product.name}
              source={product.source}
              variants={product.variants}
              lowThreshold={product.lowThreshold}
              canAdjust={canAdjust}
            />
          </Panel>
          {product.specs.length > 0 ? (
            <Panel>
              <PanelHeader title="Specifications" />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-4 p-4 sm:grid-cols-3 sm:p-5">
                {product.specs.map((s) => (
                  <div key={s.label} className="min-w-0">
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">{s.label}</dt>
                    <dd className="mt-0.5 break-words text-sm text-brand-ink">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          ) : (
            product.highlights.length > 0 && (
              <Panel>
                <PanelHeader title="Highlights" />
                <ul className="list-disc space-y-1 py-4 pl-9 pr-4 text-sm text-brand-ink sm:pr-5">
                  {product.highlights.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              </Panel>
            )
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <Panel>
            <PanelHeader title="Details" />
            <KeyValue
              items={[
                { label: "Category", value: product.categoryLabel },
                { label: "Scale", value: product.scale },
                { label: "Badge", value: product.badge ? <Tag>{product.badge}</Tag> : "None" },
                { label: "Visibility", value: PRODUCT_STATUS_META[product.status].hint },
                { label: "Price source", value: priceSource },
                ...(product.createdAt
                  ? [{ label: "Created", value: `${formatDateShort(product.createdAt, now)}${product.createdBy ? ` · ${product.createdBy.split("@")[0]}` : ""}` }]
                  : []),
              ]}
            />
          </Panel>
          <Panel>
            <PanelHeader
              title="Recent activity"
              actions={
                activity.length > 0 ? (
                  <ButtonLink href={activityHref} size="sm" variant="ghost">
                    View all
                  </ButtonLink>
                ) : undefined
              }
            />
            <ActivityTimeline items={activity} now={now} emptyText="Changes made in the admin will be listed here." />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Media({ product, editHref, canEdit }: { product: ProductDetail; editHref: string; canEdit: boolean }) {
  if (product.images.length === 0)
    return (
      <Panel>
        <EmptyState
          icon={ImageOff}
          title="No images yet"
          description={product.source === "draft" ? "Add a primary image and gallery in the editor." : "Catalogue images come from the product code."}
          action={
            product.source === "draft" && canEdit ? (
              <ButtonLink href={editHref} variant="primary">
                Add images
              </ButtonLink>
            ) : undefined
          }
        />
      </Panel>
    );
  return (
    <Panel>
      <PanelHeader
        title="Media"
        description={product.source === "draft" ? "The first image is the primary image" : "Hero, gallery and colour images from the catalogue"}
        actions={
          product.source === "draft" && canEdit ? (
            <ButtonLink href={editHref} size="sm">
              Edit media
            </ButtonLink>
          ) : undefined
        }
      />
      <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 sm:p-5 lg:grid-cols-4">
        {product.images.map((src, i) => (
          <li key={src} className="relative aspect-square overflow-hidden rounded-lg border border-admin-line bg-admin-subtle">
            <Image
              src={src}
              alt={`${product.name} image ${i + 1}`}
              fill
              sizes="(max-width: 640px) 50vw, 25vw"
              className="object-contain p-2"
              unoptimized={/^https?:/.test(src)}
            />
            {i === 0 && (
              <span className="absolute left-2 top-2 rounded bg-brand-ink px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-white">
                Primary
              </span>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
