"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/admin/Button";
import { useToast } from "@/components/admin/Toast";

/**
 * Customer CRM export. Downloads a site-scoped CSV from /api/admin/export
 * (name, phone, email, orders, spend, last order) — same download mechanics as
 * the dashboard's DataExport, scoped to a single button.
 */
export function CustomersExport() {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function download() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/export?dataset=customers`);
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        toast({ title: `Export failed (${res.status})`, description: msg || undefined, tone: "error" });
        return;
      }
      const blob = await res.blob();
      // Pull the server-suggested filename out of Content-Disposition.
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] ?? "prc-customers.csv";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Customers CSV downloaded", description: filename, tone: "success" });
    } catch {
      toast({
        title: "Couldn't download customers CSV",
        description: "Check your connection and retry.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button onClick={download} loading={busy} icon={<Download size={15} aria-hidden />}>
      <span className="max-sm:hidden">Export CSV</span>
      <span className="sm:hidden">CSV</span>
    </Button>
  );
}
