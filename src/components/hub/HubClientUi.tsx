"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useCart } from "@/lib/cart-store";

const CartDrawer = dynamic(() => import("@/components/CartDrawer"), { ssr: false });
const WhatsAppFab = dynamic(() => import("@/components/WhatsAppFab"), { ssr: false });

export default function HubClientUi() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("openCart") === "1") {
      useCart.getState().open();
    }
  }, []);

  return (
    <>
      <WhatsAppFab />
      <CartDrawer />
    </>
  );
}
