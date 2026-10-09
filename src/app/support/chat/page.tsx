import type { Metadata } from "next";
import Link from "next/link";
import { getSupportSession, maskEmail } from "@/lib/support/session";
import SupportShell from "../_components/SupportShell";
import { WhatsAppButton } from "../_components/ui";
import ChatClient from "./ChatClient";

export const metadata: Metadata = {
  title: { absolute: "Support menu — PRC Support" },
  description: "Track an order, fix charging or remote problems, or reach the Pocket RC Cars team.",
  robots: { index: false },
};

export default async function SupportChatPage() {
  const session = await getSupportSession();
  return (
    <SupportShell crumbs={[{ label: "Support menu" }]} fab={false}>
      <section className="max-w-2xl mx-auto px-4 py-6 sm:py-10 space-y-4">
        <ChatClient verifiedAs={session ? maskEmail(session.email) : null} />
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-brand-line p-4">
          <p className="flex-1 text-sm text-brand-ink-soft">
            Rather talk to our team directly? WhatsApp us, or{" "}
            <Link href="/support/new" className="font-semibold text-brand-ink underline underline-offset-4">
              raise a ticket
            </Link>
            .
          </p>
          <WhatsAppButton message="Hi, I need help from the PRC team." />
        </div>
      </section>
    </SupportShell>
  );
}
