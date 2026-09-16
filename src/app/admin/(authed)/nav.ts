import {
  Activity,
  BarChart3,
  Filter,
  LayoutDashboard,
  LifeBuoy,
  Package,
  Percent,
  RotateCcw,
  Settings,
  ShoppingBag,
  Star,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/** Live badge counts from the server layout (orders needing action, reviews to moderate). */
export type AdminCounts = {
  orders?: number;
  reviews?: number;
};

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  countKey?: keyof AdminCounts;
};

export type NavGroup = { label: string; items: NavItem[] };

/** Single source for the sidebar, icon rail, drawer, bottom tabs and ⌘K palette. */
export const ADMIN_NAV: NavGroup[] = [
  {
    label: "Selling",
    items: [
      { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
      { label: "Orders", href: "/admin/orders", icon: Package, countKey: "orders" },
      { label: "Products", href: "/admin/products", icon: ShoppingBag },
      { label: "Customers", href: "/admin/customers", icon: Users },
      { label: "Discounts", href: "/admin/discounts", icon: Percent },
      { label: "Reviews", href: "/admin/reviews", icon: Star, countKey: "reviews" },
    ],
  },
  {
    label: "Insights",
    items: [
      { label: "Analytics", href: "/admin/analytics", icon: BarChart3 },
      { label: "Funnel", href: "/admin/funnel", icon: Filter },
    ],
  },
  {
    label: "Money & ops",
    items: [
      { label: "Finance", href: "/admin/finance", icon: Wallet },
      { label: "Returns / RTO", href: "/admin/returns", icon: RotateCcw },
      { label: "Recovery", href: "/admin/recovery", icon: LifeBuoy },
      { label: "Activity", href: "/admin/activity", icon: Activity },
    ],
  },
  {
    label: "System",
    items: [{ label: "Settings", href: "/admin/settings", icon: Settings }],
  },
];

export const ADMIN_NAV_ITEMS: NavItem[] = ADMIN_NAV.flatMap((g) => g.items);

export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(href + "/");
}

export function activeNavItem(pathname: string): NavItem | undefined {
  return ADMIN_NAV_ITEMS.find((i) => isNavActive(pathname, i.href));
}
