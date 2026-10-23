import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-200 transition-colors",
        "placeholder:text-zinc-600 hover:border-zinc-700 focus:border-indigo-500/60 focus:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
