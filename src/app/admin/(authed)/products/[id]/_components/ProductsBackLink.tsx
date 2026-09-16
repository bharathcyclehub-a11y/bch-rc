"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PRODUCTS_QUERY_KEY } from "../../constants";

/** "← Products" that returns to the list with the operator's last filters. */
export function ProductsBackLink({ label = "Products" }: { label?: string }) {
  const router = useRouter();
  return (
    <Link
      href="/admin/products"
      onClick={(e) => {
        let qs = "";
        try {
          qs = sessionStorage.getItem(PRODUCTS_QUERY_KEY) ?? "";
        } catch {
          qs = "";
        }
        if (qs) {
          e.preventDefault();
          router.push(`/admin/products?${qs}`);
        }
      }}
      className="-ml-1 mb-2 inline-flex h-8 items-center gap-1.5 rounded-md px-1 text-[13px] font-medium text-admin-muted hover:text-brand-ink max-md:h-10"
    >
      <ArrowLeft size={15} aria-hidden />
      {label}
    </Link>
  );
}
