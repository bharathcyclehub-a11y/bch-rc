"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./Button";

const MODAL_WIDTH = { sm: "md:max-w-sm", md: "md:max-w-lg", lg: "md:max-w-2xl" } as const;

const PANEL = {
  modal: "admin-anim-pop max-h-[calc(100dvh-32px)] rounded-xl",
  sheet: "admin-anim-sheet max-h-[88dvh] rounded-t-2xl md:h-full md:max-h-none md:w-[420px] md:rounded-none",
  drawer: "admin-anim-right h-full max-h-none w-[300px] max-w-[85vw]",
} as const;

const FRAME = {
  modal: "items-center justify-center p-4",
  sheet: "items-end md:items-stretch md:justify-end",
  drawer: "items-stretch justify-start",
} as const;

/**
 * Native <dialog> (top layer, focus trap, Escape, ::backdrop) in three shapes:
 *  - "modal":  centred card — confirmations, short forms, command palette.
 *  - "sheet":  bottom sheet on phones, right drawer from 768px — filters,
 *              stock adjustments, row menus on touch.
 *  - "drawer": left navigation drawer.
 * Content mounts only while open, so per-open state resets for free.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = "modal",
  size = "md",
  placement = "center",
  hideHeader,
  className,
  bodyClassName,
}: {
  open: boolean;
  onClose: () => void;
  /** Always required (it labels the dialog); hidden visually with hideHeader. */
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  variant?: keyof typeof PANEL;
  size?: keyof typeof MODAL_WIDTH;
  placement?: "center" | "top";
  hideHeader?: boolean;
  className?: string;
  bodyClassName?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // showModal() focuses the first focusable element (often the close
      // button); an explicit [data-autofocus] target wins.
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);

  // showModal() doesn't stop the page behind from scrolling.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = prev;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={cn(
        "admin-dialog fixed inset-0 m-0 h-full max-h-none w-full max-w-none bg-transparent p-0 text-brand-ink open:flex",
        FRAME[variant],
        variant === "modal" && placement === "top" && "items-start pt-[12vh]",
      )}
    >
      {open && (
        <div
          className={cn(
            "flex w-full flex-col bg-white shadow-[0_24px_48px_-12px_rgba(10,10,10,0.25)]",
            PANEL[variant],
            variant === "modal" && MODAL_WIDTH[size],
            className,
          )}
        >
          <div
            className={cn(
              "flex items-start gap-3 border-b border-admin-line px-4 py-3.5 sm:px-5",
              hideHeader && "sr-only",
            )}
          >
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-[15px] font-semibold leading-5">
                {title}
              </h2>
              {description && <div className="mt-1 text-[13px] leading-5 text-admin-muted">{description}</div>}
            </div>
            <IconButton label="Close" size="sm" onClick={onClose} className="-mr-1.5 -mt-1">
              <X size={16} aria-hidden />
            </IconButton>
          </div>
          <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5", bodyClassName)}>{children}</div>
          {footer && (
            <div className="flex items-center justify-end gap-2 border-t border-admin-line px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 sm:px-5">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
