import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

const VARIANTS = {
  neutral: "border-zinc-800 bg-zinc-900/60 text-zinc-300",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  danger: "border-rose-500/30 bg-rose-500/10 text-rose-300",
} as const;

export interface AlertProps extends ComponentProps<"div"> {
  variant?: keyof typeof VARIANTS;
}

export function Alert({ className, variant = "neutral", ...props }: AlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-xs leading-relaxed",
        "[&_svg]:mt-px [&_svg]:size-3.5 [&_svg]:shrink-0",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("font-semibold", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-[11px] opacity-80", className)} {...props} />;
}
