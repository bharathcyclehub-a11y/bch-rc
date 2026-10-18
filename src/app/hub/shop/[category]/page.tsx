import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { LEGACY_CATEGORY_REDIRECTS } from "@/lib/categories";

export const metadata: Metadata = {
  title: "Redirecting to Collection…",
  robots: { index: false, follow: true },
};

export default async function HubCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  const target = LEGACY_CATEGORY_REDIRECTS[category];
  if (target) {
    permanentRedirect(target);
  }
  notFound();
}
