"use client";

import { ArrowRight, Copy, FileText, MessageCircle, Truck } from "lucide-react";
import { ActionMenu, type ActionItem } from "@/components/admin/ActionMenu";
import { whatsappHref } from "@/lib/admin/format";

/** Courier tracking links must be real web URLs — never javascript:/data:. */
function webUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

const ICON = { size: 15, "aria-hidden": true, className: "text-admin-muted" } as const;

/** Row "⋮" menu for the orders table. Serialisable props only. */
export function OrderRowActions({
  orderId,
  phone,
  trackingUrl,
}: {
  orderId: string;
  phone: string | null;
  trackingUrl: string | null;
}) {
  const orderHref = `/admin/orders/${orderId}`;
  const wa = whatsappHref(phone);
  const track = webUrl(trackingUrl);

  const items: ActionItem[] = [
    { label: "Open order", icon: <ArrowRight {...ICON} />, href: orderHref },
    // Same as the detail page: the printable invoice opens in a new tab.
    { label: "Invoice", icon: <FileText {...ICON} />, href: `${orderHref}/invoice`, external: true },
    { label: "Copy order ID", icon: <Copy {...ICON} />, copy: orderId },
    {
      label: "WhatsApp customer",
      icon: <MessageCircle {...ICON} />,
      href: wa ?? undefined,
      external: true,
      hidden: !wa,
    },
    {
      label: "Track shipment",
      icon: <Truck {...ICON} />,
      href: track ?? undefined,
      external: true,
      hidden: !track,
    },
  ];

  return <ActionMenu items={items} label={`Actions for ${orderId}`} title={orderId} />;
}
