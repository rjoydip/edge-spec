import type { ComponentProps } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../lib/utils";

const Tabs = TabsPrimitive.Root;

function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List className={cn("inline-flex items-center gap-1", className)} {...props} />
  );
}

function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        // No border: the row is a set of pills, and a border on the active one
        // only would break the rhythm.
        "flex h-9 items-center gap-2 rounded-xl px-3.5 text-xs font-medium whitespace-nowrap text-zinc-400 transition",
        "hover:bg-zinc-800/40 hover:text-zinc-200",
        "data-[state=active]:bg-zinc-800/90 data-[state=active]:text-indigo-300",
        "data-[state=active]:ring-1 data-[state=active]:ring-inset data-[state=active]:ring-zinc-700/40",
        "focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("tab-panel focus-visible:outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
