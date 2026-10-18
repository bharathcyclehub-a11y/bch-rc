import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, BookOpen, ChevronRight, HelpCircle } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { AnnouncementBar } from "@/components/AnnouncementBar";
import HubClientUi from "@/components/hub/HubClientUi";
import { BUYING_GUIDES, getBuyingGuideBySlug } from "@/lib/guides";
import { PRIMARY_CATEGORIES, getCategoryBySlug } from "@/lib/categories";
import { PRODUCTS, type Sku } from "@/lib/products";
import { THEME } from "@/lib/theme";
import { formatINR } from "@/lib/utils";

export function generateStaticParams() {
  return BUYING_GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = getBuyingGuideBySlug(slug);
  if (!guide) {
    return { title: "Guide Not Found", robots: { index: false, follow: false } };
  }
  const canonicalUrl = `https://${THEME.domain}/guides/${guide.slug}`;
  return {
    title: { absolute: guide.seoTitle },
    description: guide.seoDescription,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: guide.seoTitle,
      description: guide.seoDescription,
      url: canonicalUrl,
      siteName: THEME.brandName,
      type: "article",
      locale: "en_IN",
      images: [
        {
          url: guide.heroImage,
          width: 1200,
          height: 630,
          alt: guide.heroImageAlt,
        },
      ],
    },
  };
}

export default async function BuyingGuideDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = getBuyingGuideBySlug(slug);
  if (!guide) notFound();

  const primaryCat =
    getCategoryBySlug(guide.primaryCategorySlug) ?? PRIMARY_CATEGORIES[0];
  const recommendedProducts = guide.recommendedProductSlugs
    .map((s) => PRODUCTS.find((p) => p.slug === s))
    .filter((p): p is Sku => Boolean(p && !p.hidden && !p.internal));

  const canonicalUrl = `https://${THEME.domain}/guides/${guide.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${canonicalUrl}#article`,
        headline: guide.title,
        description: guide.seoDescription,
        image: `https://${THEME.domain}${guide.heroImage}`,
        datePublished: guide.updatedDate,
        dateModified: guide.updatedDate,
        author: {
          "@type": "Organization",
          name: THEME.brandName,
          url: `https://${THEME.domain}/`,
        },
        publisher: {
          "@type": "Organization",
          name: THEME.brandName,
          url: `https://${THEME.domain}/`,
        },
        mainEntityOfPage: canonicalUrl,
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${canonicalUrl}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: `https://${THEME.domain}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Buying Guides",
            item: `https://${THEME.domain}/guides`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: guide.title,
            item: canonicalUrl,
          },
        ],
      },
      ...(guide.faqs.length > 0
        ? [
            {
              "@type": "FAQPage",
              "@id": `${canonicalUrl}#faq`,
              mainEntity: guide.faqs.map((f) => ({
                "@type": "Question",
                name: f.question,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: f.answer,
                },
              })),
            },
          ]
        : []),
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <AnnouncementBar />
      <Header />
      <main className="min-h-screen bg-brand-cream text-brand-ink">
        <article className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
          {/* Breadcrumbs */}
          <nav
            aria-label="Breadcrumb"
            className="mb-5 flex flex-wrap items-center gap-1.5 text-xs text-brand-ink-soft"
          >
            <Link href="/" className="transition hover:text-brand-red">
              Home
            </Link>
            <ChevronRight size={12} className="text-brand-ink-soft/50" />
            <Link href="/guides" className="transition hover:text-brand-red">
              Buying Guides
            </Link>
            <ChevronRight size={12} className="text-brand-ink-soft/50" />
            <span className="truncate font-semibold text-brand-red" aria-current="page">
              {guide.title}
            </span>
          </nav>

          {/* Header Card */}
          <header className="rounded-3xl border border-brand-line bg-white p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-red/10 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-brand-red">
                <BookOpen size={12} />
                {guide.kicker}
              </span>
              <span className="text-brand-ink-soft">
                {guide.readMinutes} min read · Updated {guide.updatedDate}
              </span>
              <span className="text-brand-ink-soft/40">·</span>
              <Link
                href={primaryCat.url}
                className="font-bold text-brand-red hover:underline"
              >
                Shop {primaryCat.name} →
              </Link>
            </div>

            <h1 className="mt-3 font-display text-2xl font-extrabold leading-tight text-brand-ink sm:text-4xl">
              {guide.title}
            </h1>

            <p className="mt-3 text-sm leading-relaxed text-brand-ink-soft sm:text-base">
              {guide.summary}
            </p>
          </header>

          {/* Sections */}
          <div className="mt-6 space-y-6">
            {guide.sections.map((sec) => (
              <section
                key={sec.heading}
                className="rounded-3xl border border-brand-line bg-white p-6 sm:p-8"
              >
                <h2 className="font-display text-xl font-extrabold text-brand-ink sm:text-2xl">
                  {sec.heading}
                </h2>
                <div className="mt-3 space-y-3 text-sm leading-relaxed text-brand-ink-soft sm:text-base">
                  {sec.paragraphs.map((p, idx) => (
                    <p key={idx}>{p}</p>
                  ))}
                </div>

                {sec.comparisonRows && sec.colHeaders && (
                  <div className="mt-5 overflow-x-auto rounded-2xl border border-brand-line">
                    <table className="w-full text-left text-xs sm:text-sm">
                      <thead className="bg-brand-cream font-bold text-brand-ink">
                        <tr>
                          <th className="p-3">Feature</th>
                          <th className="p-3">{sec.colHeaders[0]}</th>
                          <th className="p-3">{sec.colHeaders[1]}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-brand-line">
                        {sec.comparisonRows.map((row) => (
                          <tr key={row.attribute}>
                            <td className="p-3 font-semibold text-brand-ink">
                              {row.attribute}
                            </td>
                            <td className="p-3 text-brand-ink-soft">{row.colA}</td>
                            <td className="p-3 text-brand-ink-soft">{row.colB}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ))}
          </div>

          {/* Recommended Products from this Guide */}
          {recommendedProducts.length > 0 && (
            <section className="mt-8 rounded-3xl border border-brand-line bg-white p-6 sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
                <div>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-brand-red">
                    Featured Models
                  </span>
                  <h2 className="font-display text-xl font-extrabold uppercase tracking-wide text-brand-ink sm:text-2xl">
                    Shop Models Mentioned in This Guide
                  </h2>
                </div>
                <Link
                  href={primaryCat.url}
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand-red px-4 py-2 text-xs font-bold text-white transition hover:bg-brand-red-hover"
                >
                  Open {primaryCat.name} Store
                  <ArrowRight size={13} />
                </Link>
              </div>

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:grid-cols-3">
                {recommendedProducts.map((sku) => {
                  const onlinePrice = Math.max(0, sku.retailINR - 100);
                  return (
                    <Link
                      key={sku.id}
                      href={`/product/${sku.slug}`}
                      className="group flex flex-col rounded-2xl border border-brand-line bg-brand-cream p-3.5 transition hover:border-brand-red hover:bg-white"
                    >
                      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-white">
                        <Image
                          src={sku.heroImage}
                          alt={sku.name}
                          fill
                          sizes="(min-width: 768px) 220px, 50vw"
                          className="object-contain p-2 transition-transform group-hover:scale-105"
                        />
                      </div>
                      <div className="mt-3 font-mono text-[10px] font-bold uppercase text-brand-red">
                        {sku.scale} Scale
                      </div>
                      <div className="font-display text-sm font-extrabold text-brand-ink group-hover:text-brand-red">
                        {sku.name}
                      </div>
                      <div className="mt-1 text-xs font-extrabold text-emerald-700">
                        {formatINR(onlinePrice)} online · View Model →
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {/* Guide FAQs */}
          {guide.faqs.length > 0 && (
            <section className="mt-8 rounded-3xl border border-brand-line bg-white p-6 sm:p-8">
              <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-brand-red">
                <HelpCircle size={14} />
                Quick Answers
              </div>
              <h2 className="mt-1 font-display text-xl font-extrabold uppercase tracking-wide text-brand-ink sm:text-2xl">
                Frequently Asked Questions
              </h2>
              <div className="mt-4 space-y-3">
                {guide.faqs.map((f) => (
                  <div
                    key={f.question}
                    className="rounded-2xl border border-brand-line bg-brand-cream p-4"
                  >
                    <h3 className="text-sm font-bold text-brand-ink">
                      {f.question}
                    </h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-brand-ink-soft sm:text-sm">
                      {f.answer}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </article>
      </main>
      <Footer />
      <HubClientUi />
    </>
  );
}
