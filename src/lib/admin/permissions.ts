/**
 * Admin permission seam. Pages and actions ask `can(role, …)` instead of
 * checking roles inline, and EVERY server action re-checks on the server —
 * hiding a button is never the control.
 *
 * Roles (admin_role enum):
 *   OWNER               everything
 *   MANAGER             everything except owner-only actions and refund approval
 *   SUPPORT             support agent: tickets, replies, tracking resync, refund REQUESTS
 *   SUPPORT_SUPERVISOR  + assignment, claim decisions, help-article edits
 *   WAREHOUSE           fulfilment: claim fulfilment, tracking, inventory
 *   FINANCE             refund approval/execution (and read access to support)
 *
 * A support agent can open the dashboard but never gains refund approval:
 * "refunds.approve" is OWNER + FINANCE only.
 */

import type { AdminContext } from "@/lib/admin-auth";

export type AdminRole = AdminContext["role"];

export type AdminPermission =
  | "products.edit"
  | "products.create"
  | "products.delete"
  | "inventory.adjust"
  | "support.view"
  | "support.reply"
  | "support.assign"
  | "support.settings"
  | "claims.decide"
  | "claims.fulfil"
  | "refunds.request"
  | "refunds.approve"
  | "tracking.resync"
  | "exceptions.manage"
  | "articles.edit";

const LEGACY: readonly AdminRole[] = ["OWNER", "MANAGER", "SUPPORT"];

const MATRIX: Record<AdminPermission, readonly AdminRole[]> = {
  "products.edit": LEGACY,
  "products.create": LEGACY,
  "inventory.adjust": [...LEGACY, "WAREHOUSE"],
  "products.delete": ["OWNER"],

  "support.view": ["OWNER", "MANAGER", "SUPPORT", "SUPPORT_SUPERVISOR", "WAREHOUSE", "FINANCE"],
  "support.reply": ["OWNER", "MANAGER", "SUPPORT", "SUPPORT_SUPERVISOR"],
  "support.assign": ["OWNER", "MANAGER", "SUPPORT_SUPERVISOR"],
  "support.settings": ["OWNER", "MANAGER"],
  "claims.decide": ["OWNER", "MANAGER", "SUPPORT_SUPERVISOR"],
  "claims.fulfil": ["OWNER", "MANAGER", "SUPPORT_SUPERVISOR", "WAREHOUSE"],
  "refunds.request": ["OWNER", "MANAGER", "SUPPORT", "SUPPORT_SUPERVISOR"],
  "refunds.approve": ["OWNER", "FINANCE"],
  "tracking.resync": ["OWNER", "MANAGER", "SUPPORT", "SUPPORT_SUPERVISOR", "WAREHOUSE"],
  "exceptions.manage": ["OWNER", "MANAGER", "SUPPORT", "SUPPORT_SUPERVISOR", "WAREHOUSE"],
  "articles.edit": ["OWNER", "MANAGER", "SUPPORT_SUPERVISOR"],
};

export function can(role: AdminRole, permission: AdminPermission): boolean {
  return MATRIX[permission].includes(role);
}

export type PermissionSet = Record<AdminPermission, boolean>;

export function permissionsFor(role: AdminRole): PermissionSet {
  return Object.fromEntries(
    (Object.keys(MATRIX) as AdminPermission[]).map((p) => [p, can(role, p)]),
  ) as PermissionSet;
}

export const ROLE_LABEL: Record<AdminRole, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  SUPPORT: "Support agent",
  SUPPORT_SUPERVISOR: "Support supervisor",
  WAREHOUSE: "Warehouse",
  FINANCE: "Finance",
};
