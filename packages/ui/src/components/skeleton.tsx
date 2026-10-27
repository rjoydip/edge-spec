import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

/** A single shimmer shape; the wrapper decides size and radius. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("skeleton rounded-md bg-zinc-800/70", className)} {...props} />;
}
