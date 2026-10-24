import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

interface ViewTabItem {
  id: string;
  label: string;
  icon?: LucideIcon;
}

interface ViewTabsProps {
  value: string;
  onChange: (value: string) => void;
  items: ViewTabItem[];
  className?: string;
}

/**
 * A small tab strip for switching one panel between two views. It reads as a
 * tab, not as a toggle button, so the two views feel like the same panel.
 */
export function ViewTabs({ value, onChange, items, className }: ViewTabsProps) {
  return (
    <div role="tablist" className={cn("flex items-center gap-0.5", className)}>
      {items.map((item) => {
        const Icon = item.icon;
        const active = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-[11px] font-medium transition",
              active
                ? "border-indigo-400 text-indigo-300"
                : "border-transparent text-zinc-500 hover:text-zinc-300",
            )}
          >
            {Icon && <Icon className="size-3.5" />}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
