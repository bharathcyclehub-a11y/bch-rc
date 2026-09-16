import type { ReactNode } from "react";

/**
 * Bottom-pinned save bar for editors (the tab bar is hidden on those routes).
 * Offset by the nav width so it spans only the content column; pages using it
 * need ~96px of bottom padding so the last field isn't covered.
 */
export function StickyActionBar({ status, children }: { status?: ReactNode; children: ReactNode }) {
  return (
    <div
      className="fixed bottom-0 right-0 z-30 border-t border-admin-line bg-white/95 backdrop-blur"
      style={{ left: "var(--admin-sidebar-w)" }}
    >
      <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 md:px-6 xl:px-8">
        <div className="min-w-0 flex-1 text-[13px] text-brand-ink-soft max-sm:hidden">{status}</div>
        <div className="flex w-full items-center gap-2 sm:w-auto">{children}</div>
      </div>
    </div>
  );
}
