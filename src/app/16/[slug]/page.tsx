import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Header16 from "@/components/store16/Header16";
import Footer16 from "@/components/store16/Footer16";
import Pdp16 from "@/components/store16/Pdp16";
import { STORE16_PRODUCTS, getStore16Product } from "@/lib/store16";
import { getSkuBySlug } from "@/lib/products";
import { getOverrideMap } from "@/lib/product-overrides";
import { getStockMap } from "@/lib/inventory";
import { resolveProductAvailability } from "@/lib/availability";

export const revalidate = 60;

export function generateStaticParams() {
  return STORE16_PRODUCTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = getStore16Product(slug);
  if (!product) return {};
  return {
    title: `${product.name} — 1:16 RC drift car | PRC Cars`,
    description: product.tagline,
  };
}

export default async function Store16ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = getStore16Product(slug);
  if (!product) notFound();

  const sku = getSkuBySlug(slug);
  const [overridesMap, stockMap] = await Promise.all([
    getOverrideMap().catch(() => new Map()),
    getStockMap().catch(() => null),
  ]);
  const ov = overridesMap.get(slug);
  if (ov?.hidden === true || sku?.hidden) notFound();
  if (sku && stockMap !== null) {
    const avail = resolveProductAvailability(sku, stockMap, ov);
    if (!avail.purchasable) notFound();
  }

  return (
    <>
      <Header16 />
      <main className="flex-1">
        <Pdp16 product={product} />
      </main>
      <Footer16 />
    </>
  );
}
