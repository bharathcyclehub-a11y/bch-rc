"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArrowUpRight, Eye, EyeOff, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { ActionMenu, type ActionItem } from "@/components/admin/ActionMenu";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { useToast } from "@/components/admin/Toast";
import type { AdminProduct } from "@/lib/admin/catalog";
import type { PermissionSet } from "@/lib/admin/permissions";
import { ProductActionDialog, type ProductAction } from "../../ProductActionDialog";
import { clearProductOverride } from "../actions";

/** "More" menu on the product control centre. */
export function ProductHeaderActions({ product, permissions }: { product: AdminProduct; permissions: PermissionSet }) {
  const router = useRouter();
  const toast = useToast();
  const [action, setAction] = useState<ProductAction | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const p = product;
  const catalogue = p.source === "catalogue";
  const canEdit = permissions["products.edit"];
  const icon = (I: typeof Eye) => <I size={15} aria-hidden />;

  const items: ActionItem[] = [
    { label: "View on store", icon: icon(ArrowUpRight), href: p.storefrontPath ?? "#", external: true, hidden: !p.storefrontPath },
    { label: "Set active", icon: icon(Eye), hidden: !catalogue || !canEdit || p.status === "active", onSelect: () => setAction({ kind: "visibility", visibility: "active", products: [p] }) },
    { label: "Mark coming soon", icon: icon(Sparkles), hidden: !catalogue || !canEdit || p.status === "coming", onSelect: () => setAction({ kind: "visibility", visibility: "coming", products: [p] }) },
    { label: "Reset to catalogue values", icon: icon(RotateCcw), hidden: !catalogue || !canEdit || !p.overridden, onSelect: () => setResetOpen(true) },
    { label: "Hide from store", icon: icon(EyeOff), tone: "danger", hidden: !catalogue || !canEdit || p.status === "hidden", onSelect: () => setAction({ kind: "visibility", visibility: "hidden", products: [p] }) },
    { label: "Archive", icon: icon(Archive), hidden: catalogue || !canEdit || p.status === "archived", onSelect: () => setAction({ kind: "draft-status", status: "archived", products: [p] }) },
    { label: "Restore to draft", icon: icon(RotateCcw), hidden: catalogue || !canEdit || p.status !== "archived", onSelect: () => setAction({ kind: "draft-status", status: "draft", products: [p] }) },
    { label: "Delete permanently…", icon: icon(Trash2), tone: "danger", hidden: catalogue || !permissions["products.delete"], onSelect: () => setAction({ kind: "delete", product: p }) },
  ];

  async function reset() {
    setBusy(true);
    const res = await clearProductOverride(p.id);
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Nothing changed", description: res.error, tone: "error" });
      return;
    }
    setResetOpen(false);
    toast({ title: "Reverted to catalogue values", tone: "success" });
    startTransition(() => router.refresh());
  }

  if (items.every((i) => i.hidden)) return null;

  return (
    <>
      <ActionMenu items={items} label="More actions" title={p.name} size="md" className="border border-admin-line-strong bg-white" />
      <ProductActionDialog action={action} onClose={() => setAction(null)} redirectTo="/admin/products" />
      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={reset}
        busy={busy}
        title="Reset to catalogue values?"
        description="Removes the admin price, MRP, status and badge edits for this product. The storefront and checkout go back to the values in the catalogue code. Stock is not affected."
        confirmLabel="Reset"
      />
    </>
  );
}
