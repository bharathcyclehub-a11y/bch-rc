import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/admin/format";

export function Avatar({ name, className }: { name: string | null | undefined; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-full bg-admin-subtle text-[11px] font-semibold text-brand-ink-soft ring-1 ring-admin-line",
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
