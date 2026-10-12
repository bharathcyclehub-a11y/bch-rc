"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/admin/Button";
import { useToast } from "@/components/admin/Toast";
import { resyncAllDue } from "./actions";

/** "Resync all due" — one bounded tracking pass; the summary comes back as a toast. */
export function ResyncAllButton() {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      loading={pending}
      icon={<RefreshCw size={15} aria-hidden />}
      onClick={() =>
        startTransition(async () => {
          const r = await resyncAllDue();
          if (!r.ok) toast({ title: "Tracking sync failed", description: r.error, tone: "error" });
          else if (r.partial) toast({ title: "Tracking sync finished with problems", description: r.message, tone: "info" });
          else toast({ title: "Tracking sync finished", description: r.message, tone: "success" });
        })
      }
    >
      {pending ? "Syncing…" : "Resync all due"}
    </Button>
  );
}
