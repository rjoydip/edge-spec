import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../lib/utils";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Icon-only actions beside the close button, e.g. download. */
  actions?: ReactNode;
  className?: string;
}

/** Shadcn-style Radix dialog: focus trap, Escape, backdrop and enter/exit motion. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  actions,
  className,
}: DialogProps) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className={cn(
            "dialog-content fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-2xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-0 text-zinc-100 shadow-2xl focus:outline-none",
            className,
          )}
        >
          <div className="flex max-h-[85vh] flex-col">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
              <div className="min-w-0">
                <DialogPrimitive.Title className="truncate text-sm font-semibold text-zinc-100">
                  {title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description
                  className={cn(
                    "mt-0.5 truncate text-[11px] text-zinc-500",
                    !description && "sr-only",
                  )}
                >
                  {description ?? title}
                </DialogPrimitive.Description>
              </div>
              <div className="flex shrink-0 flex-row-reverse items-center gap-1">
                <DialogPrimitive.Close asChild>
                  <button
                    type="button"
                    aria-label="Close dialog"
                    className="rounded-lg p-1.5 text-zinc-500 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    <X className="size-4" />
                  </button>
                </DialogPrimitive.Close>
                {actions}
              </div>
            </div>

            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>

            {footer && (
              <div className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
                {footer}
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
