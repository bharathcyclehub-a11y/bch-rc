import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Track Your Order — Live AWB & Delivery Status",
  description:
    "Track your Pocket RC Cars order in real time using your PRC Order ID and phone number. Dispatched within 24 hours from our Bangalore warehouse.",
  alternates: {
    canonical: "https://pocketrccars.com/track",
  },
};

export default function TrackLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
