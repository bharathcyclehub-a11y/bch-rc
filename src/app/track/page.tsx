import { redirect } from "next/navigation";

/**
 * Legacy tracker URL. Order emails / WhatsApp messages and the store nav still
 * link to /track?id=PRC-…, so keep the path alive and hand over to the
 * support-centre tracker with the id preserved.
 */
export default async function LegacyTrackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).id;
  const id = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  redirect(id ? `/support/track?id=${encodeURIComponent(id)}` : "/support/track");
}
