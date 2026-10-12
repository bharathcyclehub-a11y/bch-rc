import Link from "next/link";
import { ChevronRight, Inbox, SearchX, ShieldAlert } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { formatRelative, requestTime } from "@/lib/admin/format";
import { can } from "@/lib/admin/permissions";
import {
  isMissingTableError,
  listAdmins,
  listTicketsForAdmin,
  TICKET_FOCUS,
  TICKET_VIEWS,
  type TicketFocus,
  type TicketListRow,
  type TicketView,
} from "@/lib/support/admin-queries";
import { CATEGORY_KEYS, TICKET_CATEGORIES, type Priority } from "@/lib/support/rules";
import { cn } from "@/lib/utils";
import { ButtonLink } from "@/components/admin/Button";
import { FilterChip } from "@/components/admin/Chip";
import { EmptyState } from "@/components/admin/EmptyState";
import { UrlFilters, type FilterDef } from "@/components/admin/Filters";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pagination } from "@/components/admin/Pagination";
import { Panel } from "@/components/admin/Panel";
import { SearchForm } from "@/components/admin/SearchForm";
import { RowLink, Table, TBody, TD, TH, THead, TR } from "@/components/admin/Table";
import { Tabs } from "@/components/admin/Tabs";
import {
  categoryLabel,
  maskPhone,
  NoAccessNotice,
  PRIORITIES,
  PRIORITY_LABEL,
  PriorityBadge,
  shortEmail,
  slaState,
  slaTextClass,
  SupportSetupNotice,
  TicketStatusBadge,
} from "../ticket-ui";
import { NewTicketButton } from "./NewTicketButton";

const PAGE_SIZE = 50;

const VIEW_LABEL: Record<TicketView, string> = {
  open: "Open",
  mine: "Mine",
  unassigned: "Unassigned",
  awaiting: "Awaiting customer",
  resolved: "Resolved",
  closed: "Closed",
  all: "All",
};

const FOCUS_LABEL: Record<TicketFocus, string> = {
  breached: "SLA breached",
  unanswered: "Unanswered conversations",
  replacements: "Pending replacements",
  refunds: "Pending refunds",
};

type SearchParams = Record<string, string | string[] | undefined>;
type ListState = {
  view: TicketView;
  q: string;
  category: string;
  priority: Priority | "";
  assignee: string;
  focus: TicketFocus | "";
};

export default async function SupportTicketsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "support.view")) return <NoAccessNotice title="Tickets" />;
  const params = await searchParams;
  const now = new Date(requestTime());

  const page = Math.max(1, Math.floor(Number(first(params.page))) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  let staff: Awaited<ReturnType<typeof listAdmins>>;
  try {
    staff = await listAdmins();
  } catch {
    staff = [];
  }
  const assigneeEmails = staff.map((a) => a.email);
  const rawAssignee = first(params.assignee);

  const state: ListState = {
    view: pick(TICKET_VIEWS, first(params.view)) || "open",
    q: first(params.q).trim().slice(0, 80),
    category: pick(CATEGORY_KEYS, first(params.category)),
    priority: pick(PRIORITIES, first(params.priority)),
    assignee: rawAssignee === "none" || assigneeEmails.includes(rawAssignee) ? rawAssignee : "",
    focus: pick(TICKET_FOCUS, first(params.focus)),
  };

  let data: Awaited<ReturnType<typeof listTicketsForAdmin>>;
  try {
    data = await listTicketsForAdmin(ctx.siteIds, ctx.email, { ...state, offset, limit: PAGE_SIZE }, now);
  } catch (err) {
    if (isMissingTableError(err)) return <SupportSetupNotice title="Tickets" />;
    throw err;
  }
  const { counts, rows, hasNext } = data;

  const filters: FilterDef[] = [
    {
      key: "category",
      label: "Category",
      options: [{ value: "", label: "All" }, ...CATEGORY_KEYS.map((k) => ({ value: k, label: TICKET_CATEGORIES[k].label }))],
    },
    { key: "priority", label: "Priority", options: [{ value: "", label: "All" }, ...PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))] },
    {
      key: "assignee",
      label: "Assignee",
      options: [
        { value: "", label: "Anyone" },
        { value: "none", label: "Unassigned" },
        ...staff.filter((a) => a.active || a.email === state.assignee).map((a) => ({ value: a.email, label: a.name || shortEmail(a.email) })),
      ],
    },
  ];

  const filtered = Boolean(state.q || state.category || state.priority || state.assignee || state.focus);
  const shown = `Showing ${fmt(rows.length ? offset + 1 : 0)}–${fmt(offset + rows.length)}`;
  const summary = filtered ? `${shown}${hasNext ? "+" : ""}` : `${shown} of ${fmt(counts[state.view])}`;

  return (
    <>
      <PageHeader
        title="Tickets"
        description={
          <span className="block truncate">
            {state.q ? `Results for “${state.q}”` : `${fmt(counts.open)} open · ${fmt(counts.unassigned)} unassigned · ${fmt(counts.mine)} assigned to you`}
          </span>
        }
        actions={can(ctx.role, "support.reply") ? <NewTicketButton /> : undefined}
      />

      <Tabs
        ariaLabel="Ticket views"
        active={state.view}
        items={TICKET_VIEWS.map((v) => ({ key: v, label: VIEW_LABEL[v], count: counts[v], href: listHref({ ...state, view: v }) }))}
      />

      <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center">
        <SearchForm
          action="/admin/support/tickets"
          defaultValue={state.q}
          placeholder="Search ticket, order, email, phone or subject"
          keep={{
            view: state.view === "open" ? undefined : state.view,
            category: state.category || undefined,
            priority: state.priority || undefined,
            assignee: state.assignee || undefined,
            focus: state.focus || undefined,
          }}
          clearHref={listHref({ ...state, q: "" })}
          className="max-md:flex-none md:max-w-md"
        />
        <UrlFilters filters={filters} />
      </div>

      {state.focus && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-admin-muted">Showing only</span>
          <FilterChip label={FOCUS_LABEL[state.focus]} href={listHref({ ...state, focus: "" })} />
        </div>
      )}

      <Panel className="mt-4">
        {rows.length === 0 ? (
          <ListEmpty page={page} state={state} filtered={filtered} />
        ) : (
          <>
            <TicketsTable rows={rows} now={now} />
            <TicketCards rows={rows} now={now} />
            <Pagination
              summary={summary}
              prevHref={page > 1 ? listHref({ ...state, page: page - 1 }) : null}
              nextHref={hasNext ? listHref({ ...state, page: page + 1 }) : null}
            />
          </>
        )}
      </Panel>
    </>
  );
}

// ── Table (md+) ─────────────────────────────────────────────────────────────

function TicketsTable({ rows, now }: { rows: TicketListRow[]; now: Date }) {
  return (
    <Table className="max-md:hidden">
      <THead>
        <TH className="pl-4 pr-3">Ticket</TH>
        <TH className="px-3">Customer</TH>
        <TH className="hidden px-3 lg:table-cell">Order</TH>
        <TH className="hidden px-3 xl:table-cell">Category</TH>
        <TH className="px-3">Priority</TH>
        <TH className="px-3">Status</TH>
        <TH className="px-3">SLA</TH>
        <TH className="hidden px-3 lg:table-cell">Assignee</TH>
        <TH align="right" className="pl-3 pr-4">Updated</TH>
      </THead>
      <TBody>
        {rows.map((t) => {
          const sla = slaState(t, now);
          const name = t.contactName || t.customerName || t.contactEmail || "—";
          return (
            <TR key={t.id}>
              <TD className="w-[30%] max-w-0 pl-4 pr-3">
                <div className="flex items-center gap-1.5">
                  <RowLink href={`/admin/support/tickets/${t.id}`} className="font-mono text-[13px]">{t.number}</RowLink>
                  {t.safetyFlag && <ShieldAlert size={14} className="shrink-0 text-tone-neg" aria-label="Safety hazard reported" />}
                </div>
                <div className="truncate text-xs text-brand-ink-soft" title={t.subject}>{t.subject}</div>
              </TD>
              <TD className="w-[16%] max-w-0 px-3">
                <div className="truncate font-medium" title={name}>{name}</div>
                {maskPhone(t.contactPhone) && <div className="truncate font-mono text-xs text-admin-muted">{maskPhone(t.contactPhone)}</div>}
              </TD>
              <TD nowrap className="hidden px-3 font-mono text-xs lg:table-cell">
                {t.orderId ?? <span className="font-sans text-admin-muted">—</span>}
              </TD>
              <TD className="hidden max-w-40 px-3 xl:table-cell">
                <div className="truncate text-brand-ink-soft">{categoryLabel(t.category)}</div>
              </TD>
              <TD nowrap className="px-3"><PriorityBadge priority={t.priority} /></TD>
              <TD nowrap className="px-3"><TicketStatusBadge status={t.status} /></TD>
              <TD nowrap className={cn("px-3 text-xs", slaTextClass(sla?.tone))}>
                {sla?.label ?? "—"}
              </TD>
              <TD nowrap className="hidden max-w-32 truncate px-3 text-brand-ink-soft lg:table-cell">
                {t.assignedTo ? shortEmail(t.assignedTo) : <span className="text-admin-muted">Unassigned</span>}
              </TD>
              <TD align="right" nowrap className="pl-3 pr-4 text-xs text-admin-muted">{formatRelative(t.updatedAt, now.getTime())}</TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

// ── Row cards (phones) ──────────────────────────────────────────────────────

function TicketCards({ rows, now }: { rows: TicketListRow[]; now: Date }) {
  return (
    <ul className="divide-y divide-admin-line md:hidden">
      {rows.map((t) => {
        const sla = slaState(t, now);
        const name = t.contactName || t.customerName || t.contactEmail || "—";
        return (
          <li key={t.id}>
            <Link href={`/admin/support/tickets/${t.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors active:bg-admin-subtle">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-[13px] font-semibold text-brand-ink">{t.number}</span>
                  {t.safetyFlag && <ShieldAlert size={14} className="shrink-0 text-tone-neg" aria-label="Safety hazard reported" />}
                  <span className="ml-auto shrink-0 pl-2 text-xs text-admin-muted">{formatRelative(t.updatedAt, now.getTime())}</span>
                </div>
                <p className="mt-0.5 truncate text-sm text-brand-ink">{t.subject}</p>
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
                  <PriorityBadge priority={t.priority} />
                  <TicketStatusBadge status={t.status} />
                </div>
                <p className="mt-1.5 truncate text-xs text-admin-muted">
                  {name}
                  {t.orderId && <> · <span className="font-mono">{t.orderId}</span></>}
                  {" · "}
                  {t.assignedTo ? shortEmail(t.assignedTo) : "Unassigned"}
                </p>
                {sla && <p className={cn("mt-0.5 text-xs", slaTextClass(sla.tone))}>{sla.label}</p>}
              </div>
              <ChevronRight size={16} aria-hidden className="shrink-0 text-admin-muted" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// ── Empty states ────────────────────────────────────────────────────────────

function ListEmpty({ page, state, filtered }: { page: number; state: ListState; filtered: boolean }) {
  if (page > 1) {
    const back = <ButtonLink href={listHref(state)} size="sm">Back to page 1</ButtonLink>;
    return <EmptyState icon={Inbox} title="You've reached the end" description="There are no more tickets past this page." action={back} />;
  }
  if (filtered) {
    const clear = <ButtonLink href={listHref({ view: state.view })} size="sm">Clear search and filters</ButtonLink>;
    const title = state.q ? `No tickets match “${state.q}”` : "No tickets match these filters";
    return <EmptyState icon={SearchX} title={title} description="Try a different search or clear the filters." action={clear} />;
  }
  const text: Record<TicketView, [string, string]> = {
    open: ["No open tickets", "New requests from the support centre appear here."],
    mine: ["Nothing assigned to you", "Tickets assigned to you appear here."],
    unassigned: ["Every open ticket is assigned", "New tickets land here until someone picks them up."],
    awaiting: ["Not waiting on any customer", "Tickets waiting for a customer reply appear here."],
    resolved: ["No resolved tickets", "Resolved tickets stay here for 7 days, then close."],
    closed: ["No closed tickets yet", "Closed tickets appear here."],
    all: ["No tickets yet", "Tickets appear here as soon as customers raise them."],
  };
  const [title, description] = text[state.view];
  return <EmptyState icon={Inbox} title={title} description={description} />;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** List URL; the default view and page 1 are omitted. */
function listHref(s: Partial<ListState> & { page?: number }): string {
  const sp = new URLSearchParams();
  if (s.view && s.view !== "open") sp.set("view", s.view);
  if (s.q) sp.set("q", s.q);
  if (s.category) sp.set("category", s.category);
  if (s.priority) sp.set("priority", s.priority);
  if (s.assignee) sp.set("assignee", s.assignee);
  if (s.focus) sp.set("focus", s.focus);
  if (s.page && s.page > 1) sp.set("page", String(s.page));
  const qs = sp.toString();
  return qs ? `/admin/support/tickets?${qs}` : "/admin/support/tickets";
}

function pick<T extends string>(allowed: readonly T[], raw: string): T | "" {
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : "";
}

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}
