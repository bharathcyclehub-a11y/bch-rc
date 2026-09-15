"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "info";
type ToastInput = { title: string; description?: string; tone?: ToastTone };
type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<(t: ToastInput) => void>(() => {});

const ICON = { success: CircleCheck, error: CircleAlert, info: Info } as const;
const ICON_TONE = { success: "text-tone-pos", error: "text-tone-neg", info: "text-tone-info" } as const;

let nextId = 1;

/**
 * Transient confirmations ("Saved", "Copied"). Top of the screen on phones so
 * they never cover the tab bar / sticky save bar; bottom-right from 768px.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (t: ToastInput) => {
      const id = nextId++;
      setToasts((all) => [...all.slice(-2), { ...t, id }]);
      window.setTimeout(() => dismiss(id), t.tone === "error" ? 7000 : 4000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 top-16 z-[60] flex flex-col gap-2 md:inset-x-auto md:bottom-6 md:right-6 md:top-auto md:w-[360px]"
      >
        {toasts.map((t) => {
          const tone = t.tone ?? "info";
          const Icon = ICON[tone];
          return (
            <div
              key={t.id}
              role={tone === "error" ? "alert" : "status"}
              className="admin-anim-pop pointer-events-auto flex items-start gap-3 rounded-xl border border-admin-line bg-white p-3.5 shadow-[0_12px_32px_-8px_rgba(10,10,10,0.22)]"
            >
              <Icon size={18} className={cn("mt-px shrink-0", ICON_TONE[tone])} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-brand-ink">{t.title}</p>
                {t.description && <p className="mt-0.5 break-words text-xs text-admin-muted">{t.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="-m-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-admin-muted hover:bg-admin-subtle hover:text-brand-ink"
              >
                <X size={14} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
