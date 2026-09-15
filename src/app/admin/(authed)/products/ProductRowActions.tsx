"use client";

import { Archive, ArrowUpRight, Eye, EyeOff, Pencil, RotateCcw, Sparkles, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { ActionMenu, type ActionItem } from "@/components/admin/ActionMenu";
import type { AdminProduct } from "@/lib/admin/catalog";
import type { PermissionSet } from "@/lib/admin/permissions";
import type { ProductAction } from "./ProductActionDialog";

/** ⋮ menu for one product; consequential items hand off to ProductActionDialog. */
export function ProductRowActions({
  product,
  permissions,
  onAction,
  size,
}: {
  product: AdminProduct;
  permissions: PermissionSet;
  onAction: (a: ProductAction) => void;
  size?: "sm" | "md";
}) {
  const p = product;
  const catalogue = p.source === "catalogue";
  const canEdit = permissions["products.edit"];
  const icon = (I: typeof Eye) => <I size={15} aria-hidden />;

  const items: ActionItem[] = [
    { label: "Open", href: `/admin/products/${p.id}`, icon: icon(SquareArrowOutUpRight) },
    { label: "Edit", href: `/admin/products/${p.id}/edit`, icon: icon(Pencil), hidden: !canEdit },
    { label: "View on store", href: p.storefrontPath ?? "#", external: true, icon: icon(ArrowUpRight), hidden: !p.storefrontPath },
    {
      label: "Set active",
      icon: icon(Eye),
      hidden: !catalogue || !canEdit || p.status === "active",
      onSelect: () => onAction({ kind: "visibility", visibility: "active", products: [p] }),
    },
    {
      label: "Mark coming soon",
      icon: icon(Sparkles),
      hidden: !catalogue || !canEdit || p.status === "coming",
      onSelect: () => onAction({ kind: "visibility", visibility: "coming", products: [p] }),
    },
    {
      label: "Hide from store",
      icon: icon(EyeOff),
      tone: "danger",
      hidden: !catalogue || !canEdit || p.status === "hidden",
      onSelect: () => onAction({ kind: "visibility", visibility: "hidden", products: [p] }),
    },
    {
      label: "Archive",
      icon: icon(Archive),
      hidden: catalogue || !canEdit || p.status === "archived",
      onSelect: () => onAction({ kind: "draft-status", status: "archived", products: [p] }),
    },
    {
      label: "Restore to draft",
      icon: icon(RotateCcw),
      hidden: catalogue || !canEdit || p.status !== "archived",
      onSelect: () => onAction({ kind: "draft-status", status: "draft", products: [p] }),
    },
    {
      label: "Delete permanently…",
      icon: icon(Trash2),
      tone: "danger",
      hidden: catalogue || !permissions["products.delete"],
      onSelect: () => onAction({ kind: "delete", product: p }),
    },
  ];

  return <ActionMenu items={items} label={`Actions for ${p.name}`} title={p.name} size={size} />;
}
