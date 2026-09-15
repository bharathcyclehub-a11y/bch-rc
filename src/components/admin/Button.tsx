import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Admin buttons. Primary is BLACK (one per view); red is reserved for accents
 * and destructive confirmations. Heights are 32/36px on desktop and grow to
 * 40/44px below 768px so every control is a comfortable touch target.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-brand-ink text-white hover:bg-neutral-800",
  secondary: "border border-admin-line-strong bg-white text-brand-ink hover:bg-admin-subtle",
  ghost: "text-brand-ink-soft hover:bg-admin-subtle hover:text-brand-ink",
  danger: "bg-tone-neg text-white hover:bg-red-800",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-[13px] max-md:h-10 max-md:px-3",
  md: "h-9 px-3.5 text-[13px] max-md:h-11 max-md:px-4 max-md:text-sm",
};

const ICON_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 w-8 max-md:h-10 max-md:w-10",
  md: "h-9 w-9 max-md:h-11 max-md:w-11",
};

export function buttonClass({
  variant = "secondary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return cn(BASE, VARIANT[variant], SIZE[size], className);
}

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
};

export function Button({
  variant,
  size,
  icon,
  loading,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: Common & { loading?: boolean } & ComponentProps<"button">) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, className })}
      {...rest}
    >
      {loading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant,
  size,
  icon,
  className,
  children,
  ...rest
}: Common & ComponentProps<typeof Link>) {
  return (
    <Link className={buttonClass({ variant, size, className })} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

/** Square icon-only button. `label` is required: it becomes aria-label + tooltip. */
export function IconButton({
  label,
  variant = "ghost",
  size = "md",
  className,
  children,
  type = "button",
  ...rest
}: { label: string; variant?: ButtonVariant; size?: ButtonSize } & ComponentProps<"button">) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(BASE, VARIANT[variant], ICON_SIZE[size], "px-0", className)}
      {...rest}
    >
      {children}
    </button>
  );
}
