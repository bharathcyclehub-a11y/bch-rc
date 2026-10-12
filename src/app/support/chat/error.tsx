"use client";

import SupportError from "../_components/SupportError";

export default function SupportRouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SupportError reset={reset} what="the support menu" />;
}
