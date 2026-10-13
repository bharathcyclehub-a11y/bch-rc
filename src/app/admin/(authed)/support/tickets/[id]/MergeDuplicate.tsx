"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/admin/Button";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { useToast } from "@/components/admin/Toast";
import { mergeDuplicateAction } from "./actions";

/** "Merge into this ticket": folds a duplicate about the same order into the ticket being viewed. */
export function MergeDuplicate({
  keepId,
  keepNumber,
  duplicateId,
  duplicateNumber,
  unverified,
}: {
  keepId: string;
  keepNumber: string;
  duplicateId: string;
  duplicateNumber: string;
  /** Matched only by email/phone and never verified — staff should be sure it's the same person. */
  unverified: boolean;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={pending}>
        Merge here
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        tone="default"
        title={`Merge ${duplicateNumber} into ${keepNumber}?`}
        description={`${duplicateNumber}'s messages and files move to this ticket, and ${duplicateNumber} closes with a note pointing here. The customer isn't emailed.${unverified ? ` ${duplicateNumber} was raised without verifying and only matches by email or phone — merge only if it's clearly the same customer.` : ""}`}
        confirmLabel="Merge"
        busy={pending}
        onConfirm={() =>
          startTransition(async () => {
            const r = await mergeDuplicateAction(duplicateId, keepId);
            setOpen(false);
            if (r.ok) toast({ title: "Tickets merged", description: r.message, tone: "success" });
            else toast({ title: "Couldn't merge", description: r.error, tone: "error" });
          })
        }
      />
    </>
  );
}
