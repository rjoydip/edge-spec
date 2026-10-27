import type { ComponentProps } from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "../lib/utils";

const TONES = {
  accent: "bg-indigo-500",
  success: "bg-emerald-500",
  warning: "bg-amber-400",
  danger: "bg-rose-500",
  info: "bg-sky-400",
  violet: "bg-violet-500",
} as const;

export interface ProgressProps extends ComponentProps<typeof ProgressPrimitive.Root> {
  tone?: keyof typeof TONES;
  /** Overrides the fill colour, for app-specific stage tokens. */
  indicatorClassName?: string;
}

/** Shadcn-style progress bar: the fill moves with a transform, never a layout tick. */
export function Progress({
  className,
  value = 0,
  tone = "accent",
  indicatorClassName,
  ...props
}: ProgressProps) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <ProgressPrimitive.Root
      value={pct}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-800/80", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          "progress-indicator size-full rounded-full transition-transform duration-700 ease-out",
          indicatorClassName ?? TONES[tone],
        )}
        style={{ transform: `translateX(-${100 - pct}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
