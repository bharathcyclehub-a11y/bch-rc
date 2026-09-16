import {
  getHubMiniSkus,
  getHubBig16Skus,
  getHub20Skus,
  getHubConstructionSkus,
  getHubPoloSkus,
  getHub43Skus,
  getHubHobbySkus,
  type Sku,
} from "@/lib/products";

/** A hub Shop category tile — key, label, round-tile image, and its products. */
export type HubCat = { key: string; label: string; img: string | null; skus: Sku[] };

/**
 * The hub Shop categories. Live tiles pull real products (Mini 1:64, Big 1:16,
 * 1:20, Construction — the last two are coming-soon teasers); the rest are
 * empty placeholders shown as "soon". Shared by the hub Shop preview and the
 * per-category pages at /hub/shop/[category].
 */
export const HUB_CATEGORIES: HubCat[] = [
  { key: "mini64", label: "Mini RC · 1:64", img: "/landing/cat-crawlers.webp", skus: getHubMiniSkus() },
  { key: "big16", label: "Big Drift · 1:16", img: "/landing/cat-drift.webp", skus: getHubBig16Skus() },
  { key: "s20", label: "1:20 Scale", img: "/landing/cat-s20.webp", skus: getHub20Skus() },
  { key: "construction", label: "Construction", img: "/landing/cat-construction.webp", skus: getHubConstructionSkus() },
  { key: "polo", label: "Polo", img: "/landing/cat-polo.webp", skus: getHubPoloSkus() },
  { key: "s43", label: "1:43 Scale", img: "/landing/cat-s43.jpg", skus: getHub43Skus() },
  { key: "drone", label: "Drone", img: "/landing/cat-drone.webp", skus: [] },
  { key: "hobby", label: "Hobby Grade", img: "/landing/cat-hobby.jpg", skus: getHubHobbySkus() },];

export function getHubCategory(key: string): HubCat | undefined {
  return HUB_CATEGORIES.find((c) => c.key === key);
}
