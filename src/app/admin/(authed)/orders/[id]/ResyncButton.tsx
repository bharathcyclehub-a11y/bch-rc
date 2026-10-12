"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/admin/Button";
import { cn } from "@/lib/utils";
import { resyncShipment } from "../../support/exceptions/actions";

/** "Resync now" for an order's FORWARD shipment; the courier's answer is shown under the button. */
export function ResyncButton({ orderId }: { orderId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        loading={pending}
        icon={<RefreshCw size={14} aria-hidden />}
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            const r = await resyncShipment({ orderId });
            setResult(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
          })
        }
      >
        Resync now
      </Button>
      {result && (
        <p
          role="status"
          className={cn("max-w-60 text-right text-xs leading-4", result.ok ? "text-tone-pos" : "text-tone-neg")}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
