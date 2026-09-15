"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { useToast } from "@/components/admin/Toast";
import { PRODUCT_STATUS_META } from "@/lib/admin/status";
import type { AdminProduct } from "@/lib/admin/catalog";
import { deleteDraftProduct, setCatalogueVisibility, setDraftStatus } from "./actions";

/** A consequential product change awaiting confirmation. */
export type ProductAction =
  | { kind: "visibility"; visibility: "active" | "coming" | "hidden"; products: AdminProduct[] }
  | { kind: "draft-status"; status: "draft" | "archived"; products: AdminProduct[] }
  | { kind: "delete"; product: AdminProduct };

const VISIBILITY_COPY = {
  active: { verb: "Set active", effect: "They'll be visible and purchasable on the storefront." },
  coming: { verb: "Mark coming soon", effect: "They'll show as a teaser tile with no buy button." },
  hidden: { verb: "Hide", effect: "They'll disappear from the storefront (their pages return 404). Nothing is deleted." },
} as const;

/**
 * One confirmation flow for every status change and delete — used by the
 * bulk bar, row menus and the product control centre. Refreshes server data
 * and reports the outcome with a toast.
 */
export function ProductActionDialog({
  action,
  onClose,
  onDone,
  redirectTo,
}: {
  action: ProductAction | null;
  onClose: () => void;
  onDone?: () => void;
  /** Where to go after a successful delete (e.g. back to the list). */
  redirectTo?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  if (!action) return <ConfirmDialog open={false} onClose={onClose} onConfirm={() => {}} title="" />;

  const names = (list: AdminProduct[]) =>
    list.length === 1 ? `“${list[0].name}”` : `${list.length} products`;

  let title = "";
  let description: React.ReactNode = null;
  let confirmLabel = "Confirm";
  let tone: "danger" | "default" = "default";
  let requireText: string | undefined;

  if (action.kind === "visibility") {
    const copy = VISIBILITY_COPY[action.visibility];
    title = `${copy.verb} — ${names(action.products)}?`;
    const noStock = action.products.filter((p) => p.stock === null).length;
    description = (
      <>
        {copy.effect}
        {action.visibility === "active" && noStock > 0 && (
          <span className="mt-2 block text-tone-warn">
            {noStock === 1 ? "1 product has" : `${noStock} products have`} no stock set up yet — shoppers will see
            {noStock === 1 ? " it" : " them"} but can&apos;t check out until stock is added.
          </span>
        )}
      </>
    );
    confirmLabel = copy.verb;
    tone = action.visibility === "hidden" ? "danger" : "default";
  } else if (action.kind === "draft-status") {
    const archiving = action.status === "archived";
    title = `${archiving ? "Archive" : "Restore"} ${names(action.products)}?`;
    description = archiving
      ? "Archived drafts are kept for reference and can be restored at any time."
      : "The products go back to Draft.";
    confirmLabel = archiving ? "Archive" : "Restore to draft";
  } else {
    title = `Delete “${action.product.name}”?`;
    description = "This permanently removes the draft and its variants. This can't be undone.";
    confirmLabel = "Delete permanently";
    tone = "danger";
    requireText = action.product.name;
  }

  async function confirm() {
    if (!action) return;
    setBusy(true);
    let res: { ok: boolean; error?: string };
    let success = "";
    if (action.kind === "visibility") {
      res = await setCatalogueVisibility(
        action.products.map((p) => p.id),
        action.visibility,
      );
      success = `${names(action.products)} → ${PRODUCT_STATUS_META[action.visibility].label}`;
    } else if (action.kind === "draft-status") {
      res = await setDraftStatus(
        action.products.map((p) => p.id),
        action.status,
      );
      success = `${names(action.products)} → ${PRODUCT_STATUS_META[action.status].label}`;
    } else {
      res = await deleteDraftProduct(action.product.id, action.product.name);
      success = `Deleted “${action.product.name}”`;
    }
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Nothing changed", description: res.error, tone: "error" });
      return;
    }
    toast({ title: "Saved", description: success, tone: "success" });
    onDone?.();
    onClose();
    startTransition(() => {
      if (action.kind === "delete" && redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={confirm}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      tone={tone}
      requireText={requireText}
      busy={busy || pending}
    />
  );
}
