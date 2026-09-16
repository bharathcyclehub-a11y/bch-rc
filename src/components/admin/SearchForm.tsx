import Form from "next/form";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export const SEARCH_INPUT_CLASS =
  "h-9 w-full rounded-lg border border-admin-line-strong bg-white pl-9 pr-9 text-sm text-brand-ink placeholder:text-admin-muted focus:border-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-red/20 max-md:h-11 [&::-webkit-search-cancel-button]:hidden";

/** Controlled search box for client-filtered lists (products). */
export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div role="search" className={cn("relative flex min-w-0 flex-1 items-center", className)}>
      <Search size={15} aria-hidden className="pointer-events-none absolute left-3 text-admin-muted" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        enterKeyHint="search"
        className={SEARCH_INPUT_CLASS}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-1 grid h-7 w-7 place-items-center rounded-md text-admin-muted hover:bg-admin-subtle hover:text-brand-ink max-md:h-9 max-md:w-9"
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * URL search box for server-rendered lists. A GET form (next/form → client
 * navigation) so the query lives in the URL: shareable and back-button safe.
 * `keep` carries the other list params (view, filters) through a search.
 */
export function SearchForm({
  action,
  defaultValue,
  placeholder,
  keep = {},
  clearHref,
  name = "q",
  className,
}: {
  action: string;
  defaultValue: string;
  placeholder: string;
  keep?: Record<string, string | undefined>;
  clearHref: string;
  name?: string;
  className?: string;
}) {
  return (
    <Form action={action} role="search" className={cn("relative flex min-w-0 flex-1 items-center", className)}>
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <Search size={15} aria-hidden className="pointer-events-none absolute left-3 text-admin-muted" />
      <input
        key={defaultValue}
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={placeholder}
        enterKeyHint="search"
        className={SEARCH_INPUT_CLASS}
      />
      {defaultValue && (
        <Link
          href={clearHref}
          scroll={false}
          aria-label="Clear search"
          className="absolute right-1 grid h-7 w-7 place-items-center rounded-md text-admin-muted hover:bg-admin-subtle hover:text-brand-ink max-md:h-9 max-md:w-9"
        >
          <X size={14} aria-hidden />
        </Link>
      )}
    </Form>
  );
}
