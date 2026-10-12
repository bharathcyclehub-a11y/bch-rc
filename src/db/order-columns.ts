/**
 * Column sets for reading `orders` in bulk.
 *
 * The database is on Supabase's free plan, where egress is the scarce
 * resource (Oct 2026: over quota). `courier_routing` holds the routing
 * engine's full record (every provider's quote and serviceability, ~1 KB per
 * booked order) and only the order detail page and the shipping report need
 * it — so list pages that would otherwise `select()` every column use this.
 */

import { getTableColumns } from "drizzle-orm";
import { orders } from "./schema";

const { courierRouting, ...rest } = getTableColumns(orders);
void courierRouting;

/** Every `orders` column except the courier routing record. */
export const orderListColumns = rest;
