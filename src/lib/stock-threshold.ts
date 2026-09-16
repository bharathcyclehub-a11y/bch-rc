/**
 * Low-stock nudge threshold for storefront badges, admin health and the admin
 * product views. Kept in a dependency-free module so client components can
 * import it without pulling the DB client in (src/lib/inventory.ts imports db).
 */
export const LOW_STOCK_THRESHOLD = 5;
