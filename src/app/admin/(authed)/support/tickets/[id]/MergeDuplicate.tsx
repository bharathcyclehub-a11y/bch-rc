"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/admin/Button";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { useToast } from "@/components/admin/Toast";
import { mergeDuplicateAction } from "./actions";

/** "Merge into this ticket": folds a duplicate about the same order into the ticket being viewed. */
export function MergeDuplicate({ keepId, keepNumber, duplicateId, duplicateNumber }: { keepId: string; keepNumber: string; duplicateId: string; duplicateNumber: string }) {
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
        description={`${duplicateNumber}'s messages and files move to this ticket, and ${duplicateNumber} closes with a note pointing here. The customer isn't emailed.`}
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
