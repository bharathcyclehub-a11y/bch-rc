import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { AnnouncementBar } from "@/components/AnnouncementBar";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import WhatsAppFab from "@/components/WhatsAppFab";
import CartDrawer from "@/components/CartDrawer";
import { POLICIES, getPolicy } from "@/lib/policies";

export function generateStaticParams() {
  return POLICIES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const policy = getPolicy(slug);
  if (!policy) return { title: "Not Found", robots: { index: false, follow: false } };
  return {
    title: policy.title,
    description: policy.intro,
    alternates: {
      canonical: `https://pocketrccars.com/policies/${policy.slug}`,
    },
  };
}

/**
 * Lightweight markdown-lite renderer: handles `## Heading`, paragraphs,
 * `- item` bullet lists, and `**bold**` / `[text](url)` inlines. No external
 * library — keeps the bundle lean.
 */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  // Combined regex: **bold** OR [text](url)
  const re = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\(([^)]+)\))/;
  while (remaining.length) {
    const m = remaining.match(re);
    if (!m || m.index === undefined) {
      nodes.push(remaining);
      break;
    }
    if (m.index > 0) nodes.push(remaining.slice(0, m.index));
    if (m[1]) {
      nodes.push(
        <strong key={key++} className="font-semibold text-brand-ink">
          {m[2]}
        </strong>
      );
    } else if (m[3]) {
      const href = m[5];
      const isExternal = href.startsWith("http");
      nodes.push(
        <Link
          key={key++}
          href={href}
          {...(isExternal
            ? { target: "_blank", rel: "noopener" }
            : {})}
          className="text-brand-red hover:underline underline-offset-4"
        >
          {m[4]}
        </Link>
      );
    }
    remaining = remaining.slice(m.index + m[0].length);
  }
  return nodes;
}

function renderBody(body: string): React.ReactNode {
  const blocks = body.split(/\n\s*\n/); // split on blank lines
  return blocks.map((block, i) => {
    const trimmed = block.trim();
    if (trimmed.startsWith("## ")) {
      return (
        <h2
          key={i}
          className="font-display text-xl sm:text-2xl font-bold text-brand-ink mt-8 sm:mt-10 mb-3"
        >
          {renderInline(trimmed.slice(3).trim())}
        </h2>
      );
    }
    if (trimmed.startsWith("- ")) {
      const items = trimmed
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("- "))
        .map((l) => l.slice(2).trim());
      return (
        <ul
          key={i}
          className="mt-3 mb-4 space-y-1.5 text-sm sm:text-base text-brand-ink-soft list-disc pl-5"
        >
          {items.map((item, j) => (
            <li key={j} className="leading-relaxed">
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
    }
    return (
      <p
        key={i}
        className="text-sm sm:text-base text-brand-ink-soft leading-relaxed mt-3"
      >
        {renderInline(trimmed)}
      </p>
    );
  });
}

export default async function PolicyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const policy = getPolicy(slug);
  if (!policy) notFound();

  return (
    <>
      <AnnouncementBar />
      <Header />
      <nav className="border-b border-brand-line bg-white">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-brand-ink-soft hover:text-brand-ink"
          >
            <ChevronLeft size={16} />
            Back to store
          </Link>
        </div>
      </nav>
      <main className="flex-1 bg-white">
        <article className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
          <p className="text-xs font-mono font-bold uppercase tracking-widest text-brand-red">
            Policies
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-brand-ink mt-2 text-balance">
            {policy.title}
          </h1>
          <p className="text-base sm:text-lg text-brand-ink-soft mt-3 leading-relaxed">
            {policy.intro}
          </p>
          <p className="text-[11px] font-mono uppercase tracking-widest text-brand-ink-soft mt-4">
            Last updated · {policy.updated}
          </p>
          <hr className="my-6 sm:my-8 border-brand-line" />
          <div className="prose-content">{renderBody(policy.body)}</div>

          {/* Cross-links to sister policies */}
          <hr className="mt-10 sm:mt-12 border-brand-line" />
          <div className="mt-6">
            <p className="text-xs font-mono font-bold uppercase tracking-widest text-brand-red mb-3">
              Related policies
            </p>
            <div className="flex flex-wrap gap-2">
              {POLICIES.filter((p) => p.slug !== policy.slug).map((p) => (
                <Link
                  key={p.slug}
                  href={`/policies/${p.slug}`}
                  className="text-xs sm:text-sm text-brand-ink hover:text-brand-red border border-brand-line hover:border-brand-red px-3 py-1.5 rounded-full transition-colors"
                >
                  {p.title}
                </Link>
              ))}
            </div>
          </div>
        </article>
      </main>
      <Footer />
      <WhatsAppFab />
      <CartDrawer />
    </>
  );
}
