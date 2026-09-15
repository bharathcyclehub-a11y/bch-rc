import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Dense data table primitives (13px text, 44–48px rows, overline headers).
 * Composable rather than a config-driven grid so each page keeps control of
 * its cells. Whole-row click is a stretched <RowLink>; any other interactive
 * cell content must sit in <TD interactive> (lifted above the stretched link).
 */

export function Table({ className, children, minWidth }: { className?: string; children: ReactNode; minWidth?: number }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[13px]" style={minWidth ? { minWidth } : undefined}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr>{children}</tr>
    </thead>
  );
}

type Align = "left" | "right" | "center";

export function TH({
  align = "left",
  className,
  children,
  ...rest
}: { align?: Align } & ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap border-b border-admin-line bg-admin-subtle/70 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({ selected, className, children }: { selected?: boolean; className?: string; children: ReactNode }) {
  return (
    <tr
      className={cn(
        "group relative border-b border-admin-line transition-colors last:border-b-0",
        selected ? "bg-brand-red-soft" : "hover:bg-admin-page",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function TD({
  align = "left",
  nowrap,
  interactive,
  className,
  children,
  ...rest
}: { align?: Align; nowrap?: boolean; interactive?: boolean } & ComponentProps<"td">) {
  return (
    <td
      className={cn(
        "px-4 py-2.5 align-middle text-brand-ink",
        align === "right" && "text-right tabular-nums",
        align === "center" && "text-center",
        nowrap && "whitespace-nowrap",
        interactive && "relative z-10",
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
}

/** Primary cell link that makes the whole row clickable. */
export function RowLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "font-semibold text-brand-ink after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:after:outline-2 focus-visible:after:outline-brand-red",
        className,
      )}
    >
      {children}
    </Link>
  );
}
