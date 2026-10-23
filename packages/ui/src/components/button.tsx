import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

const VARIANTS = {
  default:
    "bg-indigo-600 text-white shadow-lg shadow-indigo-950/20 hover:bg-indigo-500 active:scale-[0.99]",
  danger:
    "bg-rose-600 text-white shadow-lg shadow-rose-950/25 hover:bg-rose-500 active:scale-[0.99]",
  secondary: "bg-zinc-800 text-zinc-100 hover:bg-zinc-700",
  outline:
    "border border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100",
  ghost: "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100",
} as const;

const SIZES = {
  default: "h-9 px-4 text-xs",
  sm: "h-8 px-3 text-xs",
  xs: "h-7 px-2.5 text-[11px]",
  icon: "size-9",
} as const;

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
}

export function Button({
  className,
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-medium whitespace-nowrap transition-all outline-none",
        "focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
        "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
