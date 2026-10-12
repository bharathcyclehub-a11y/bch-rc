"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/admin/Badge";
import { Button } from "@/components/admin/Button";
import { Select, Switch } from "@/components/admin/Field";
import { useToast } from "@/components/admin/Toast";
import { updateAdminAccessAction } from "./actions";

type Member = { id: string; email: string; name: string | null; role: string; active: boolean };

/**
 * Team roles. Editable only by an owner (the server action re-checks
 * role === OWNER and refuses to remove the last active owner); everyone else
 * sees the same table read-only.
 */
export function TeamRoles({
  members,
  roles,
  canEdit,
  me,
}: {
  members: Member[];
  roles: Array<{ value: string; label: string }>;
  canEdit: boolean;
  me: string;
}) {
  const label = Object.fromEntries(roles.map((r) => [r.value, r.label]));
  return (
    <ul className="divide-y divide-admin-line">
      {members.map((m) =>
        canEdit ? (
          <MemberRow key={`${m.id}:${m.role}:${m.active}`} m={m} roles={roles} isMe={m.email === me} />
        ) : (
          <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-brand-ink">{m.name || m.email}</p>
              {m.name && <p className="truncate text-xs text-admin-muted">{m.email}</p>}
            </div>
            <span className="text-[13px] text-brand-ink-soft">{label[m.role] ?? m.role}</span>
            {m.active ? <Badge tone="positive">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
          </li>
        ),
      )}
    </ul>
  );
}

function MemberRow({ m, roles, isMe }: { m: Member; roles: Array<{ value: string; label: string }>; isMe: boolean }) {
  const toast = useToast();
  const [role, setRole] = useState(m.role);
  const [active, setActive] = useState(m.active);
  const [pending, startTransition] = useTransition();
  const dirty = role !== m.role || active !== m.active;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-[13px] font-medium text-brand-ink">
          {m.name || m.email}
          {isMe && <span className="ml-1.5 text-xs font-normal text-admin-muted">(you)</span>}
        </p>
        {m.name && <p className="truncate text-xs text-admin-muted">{m.email}</p>}
      </div>
      <label className="sr-only" htmlFor={`role-${m.id}`}>
        Role for {m.email}
      </label>
      <Select id={`role-${m.id}`} value={role} onChange={(e) => setRole(e.target.value)} disabled={pending} className="w-48">
        {roles.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </Select>
      <div className="w-28">
        <Switch checked={active} onChange={setActive} disabled={pending} label={active ? "Active" : "Inactive"} />
      </div>
      <Button
        size="sm"
        variant={dirty ? "primary" : "secondary"}
        disabled={!dirty}
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await updateAdminAccessAction(m.id, role, active);
            if (r.ok) toast({ title: "Access updated", description: r.message, tone: "success" });
            else {
              toast({ title: "Not changed", description: r.error, tone: "error" });
              setRole(m.role);
              setActive(m.active);
            }
          })
        }
      >
        Save
      </Button>
    </li>
  );
}
