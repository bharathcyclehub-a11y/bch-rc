/** sessionStorage key holding the products list query (filters survive list → product → back). */
export const PRODUCTS_QUERY_KEY = "admin.products.query";

export const PRODUCT_TABS = ["overview", "variants", "inventory", "media", "activity"] as const;
export type ProductTab = (typeof PRODUCT_TABS)[number];
