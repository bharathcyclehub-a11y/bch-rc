/**
 * Admin permission seam. Today every active admin may do everything that
 * existed before the redesign; the only role-gated action is the NEW permanent
 * delete of product drafts (owners only). When real RBAC lands (warehouse,
 * marketing, support…), extend the matrix here — pages and actions already ask
 * `can(role, …)` instead of checking roles inline.
 */

import type { AdminContext } from "@/lib/admin-auth";

export type AdminRole = AdminContext["role"];

export type AdminPermission =
  | "products.edit"
  | "products.create"
  | "products.delete"
  | "inventory.adjust";

const ALL: readonly AdminRole[] = ["OWNER", "MANAGER", "SUPPORT"];

const MATRIX: Record<AdminPermission, readonly AdminRole[]> = {
  "products.edit": ALL,
  "products.create": ALL,
  "inventory.adjust": ALL,
  "products.delete": ["OWNER"],
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
