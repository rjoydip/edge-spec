import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

const VARIANTS = {
  neutral: "border-zinc-800 bg-zinc-900/70 text-zinc-400",
  accent: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  danger: "border-rose-500/30 bg-rose-500/10 text-rose-400",
} as const;

export interface BadgeProps extends ComponentProps<"span"> {
  variant?: keyof typeof VARIANTS;
}

export function Badge({ className, variant = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-medium whitespace-nowrap",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
