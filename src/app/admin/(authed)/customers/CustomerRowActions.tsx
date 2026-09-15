"use client";

import { Copy, Mail, MessageCircle, Phone, UserRound } from "lucide-react";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { mobile10, telHref, whatsappHref } from "@/lib/admin/format";

/** Row "⋮" menu on the customers table. Props are plain strings (server → client). */
export function CustomerRowActions({
  id,
  name,
  phone,
  email,
}: {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
}) {
  const ten = mobile10(phone);
  const wa = whatsappHref(phone);
  const tel = telHref(phone);
  const who = name?.trim() || "customer";
  return (
    <ActionMenu
      label={`Actions for ${who}`}
      title={name?.trim() || "Customer"}
      items={[
        { label: "View profile", icon: <UserRound size={15} aria-hidden />, href: `/admin/customers/${id}` },
        {
          label: "WhatsApp",
          icon: <MessageCircle size={15} aria-hidden />,
          href: wa ?? undefined,
          external: true,
          hidden: !wa,
        },
        { label: "Call", icon: <Phone size={15} aria-hidden />, href: tel ?? undefined, hidden: !tel },
        { label: "Copy phone", icon: <Copy size={15} aria-hidden />, copy: ten ?? phone },
        {
          label: "Email",
          icon: <Mail size={15} aria-hidden />,
          href: email ? `mailto:${email}` : undefined,
          hidden: !email,
        },
      ]}
    />
  );
}
