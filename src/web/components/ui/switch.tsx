import type { ComponentProps } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({
  className,
  size = "default",
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root> & { size?: "default" | "sm" }) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
        size === "sm" ? "h-5 w-8" : "h-6 w-11",
        "data-[state=checked]:bg-indigo-600 data-[state=unchecked]:bg-zinc-800",
        "focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block rounded-full bg-white shadow transition-transform",
          size === "sm"
            ? "size-3 data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0.5"
            : "size-4 data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0.5",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
