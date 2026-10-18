import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BookOpen, ChevronRight } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { AnnouncementBar } from "@/components/AnnouncementBar";
import HubClientUi from "@/components/hub/HubClientUi";
import { BUYING_GUIDES } from "@/lib/guides";
import { PRIMARY_CATEGORIES, getCategoryBySlug } from "@/lib/categories";
import { THEME } from "@/lib/theme";

const CANONICAL_URL = `https://${THEME.domain}/guides`;

export const metadata: Metadata = {
  title: {
    absolute:
      "RC Car Buying Guides in India — 1:64 vs 1:43, Drift, Construction & Hobby Grade | Pocket RC Cars",
  },
  description:
    "Practical RC car buying guides for Indian shoppers: compare 1:64 vs 1:43 mini RC cars, beginner RC drift cars, toy-grade vs hobby-grade 4WD crawlers, and RC construction vehicles.",
  alternates: {
    canonical: CANONICAL_URL,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function GuidesIndexPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${CANONICAL_URL}#guides`,
        name: "Pocket RC Cars — Buying Guides & Scale Comparisons",
        description:
          "Practical buying guides for mini RC cars, RC drift cars, construction RC rigs, and hobby-grade 4WD crawlers in India.",
        url: CANONICAL_URL,
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${CANONICAL_URL}#breadcrumb`,
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
            item: CANONICAL_URL,
          },
        ],
      },
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
        <section className="border-b border-brand-line bg-white py-8 sm:py-12">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <nav
              aria-label="Breadcrumb"
              className="mb-4 flex items-center gap-1.5 text-xs text-brand-ink-soft"
            >
              <Link href="/" className="transition hover:text-brand-red">
                Home
              </Link>
              <ChevronRight size={12} className="text-brand-ink-soft/50" />
              <span className="font-semibold text-brand-red" aria-current="page">
                Buying Guides
              </span>
            </nav>

            <div className="inline-flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-brand-red">
              <BookOpen size={14} />
              Pocket RC Knowledge Base
            </div>
            <h1 className="mt-2 font-display text-3xl font-extrabold uppercase tracking-wide text-brand-ink sm:text-5xl">
              RC Car Buying Guides & Scale Comparisons
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-brand-ink-soft sm:text-base">
              Real-world comparisons of scale size, 2WD vs 4WD gyro drivetrains,
              proportional steering, and surface compatibility—written from our
              actual Bangalore warehouse lineup.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {BUYING_GUIDES.map((guide) => {
              const cat = getCategoryBySlug(guide.primaryCategorySlug);
              return (
                <article
                  key={guide.slug}
                  className="group flex flex-col overflow-hidden rounded-3xl border border-brand-line bg-white shadow-xs transition hover:border-brand-red hover:shadow-md"
                >
                  <Link
                    href={`/guides/${guide.slug}`}
                    className="relative aspect-[16/9] w-full overflow-hidden bg-brand-cream"
                  >
                    <Image
                      src={guide.heroImage}
                      alt={guide.heroImageAlt}
                      fill
                      sizes="(min-width: 768px) 50vw, 100vw"
                      className="object-contain p-4 transition-transform duration-300 group-hover:scale-105"
                    />
                  </Link>
                  <div className="flex flex-1 flex-col p-5 sm:p-6">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full bg-brand-red/10 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-brand-red">
                        {guide.kicker}
                      </span>
                      <span className="text-brand-ink-soft">
                        {guide.readMinutes} min read
                      </span>
                      {cat && (
                        <>
                          <span className="text-brand-ink-soft/40">·</span>
                          <Link
                            href={cat.url}
                            className="font-semibold text-brand-ink hover:text-brand-red hover:underline"
                          >
                            {cat.name}
                          </Link>
                        </>
                      )}
                    </div>

                    <h2 className="mt-2.5 font-display text-xl font-extrabold leading-snug text-brand-ink group-hover:text-brand-red sm:text-2xl">
                      <Link href={`/guides/${guide.slug}`}>{guide.title}</Link>
                    </h2>

                    <p className="mt-2 flex-1 text-xs leading-relaxed text-brand-ink-soft sm:text-sm">
                      {guide.summary}
                    </p>

                    <div className="mt-5 flex items-center justify-between border-t border-brand-line pt-4">
                      <Link
                        href={`/guides/${guide.slug}`}
                        className="inline-flex items-center gap-1.5 text-xs font-extrabold text-brand-red group-hover:underline sm:text-sm"
                      >
                        Read Full Guide
                        <ArrowRight size={14} />
                      </Link>
                      {cat && (
                        <Link
                          href={cat.url}
                          className="text-xs font-semibold text-brand-ink-soft hover:text-brand-ink"
                        >
                          Shop {cat.name} →
                        </Link>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Shop by Category strip */}
          <div className="mt-12 rounded-3xl border border-brand-line bg-white p-6 sm:p-8">
            <h2 className="font-display text-xl font-extrabold uppercase tracking-wide text-brand-ink sm:text-2xl">
              Shop Our 4 Primary RC Collections
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {PRIMARY_CATEGORIES.map((cat) => (
                <Link
                  key={cat.slug}
                  href={cat.url}
                  className="rounded-2xl border border-brand-line bg-brand-cream p-3.5 transition hover:border-brand-red hover:bg-white"
                >
                  <div className="font-mono text-[10px] font-bold uppercase text-brand-red">
                    {cat.shortLabel}
                  </div>
                  <div className="mt-0.5 font-display text-sm font-extrabold uppercase text-brand-ink">
                    {cat.name}
                  </div>
                  <div className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-brand-red">
                    View Store <ArrowRight size={11} />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <HubClientUi />
    </>
  );
}
