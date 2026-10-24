import { Brush, FlaskConical, Hammer, ShieldAlert, Type, type LucideIcon } from "lucide-react";

/** Every CI check kind keeps its own colour and icon. */
export const CHECK_TONES: Record<
  string,
  { icon: LucideIcon; iconClass: string; textClass: string }
> = {
  format: {
    icon: Brush,
    iconClass: "bg-purple-500/15 text-purple-300",
    textClass: "text-purple-300",
  },
  lint: {
    icon: ShieldAlert,
    iconClass: "bg-orange-500/15 text-orange-300",
    textClass: "text-orange-300",
  },
  typecheck: {
    icon: Type,
    iconClass: "bg-blue-500/15 text-blue-300",
    textClass: "text-blue-300",
  },
  build: {
    icon: Hammer,
    iconClass: "bg-cyan-500/15 text-cyan-300",
    textClass: "text-cyan-300",
  },
  test: {
    icon: FlaskConical,
    iconClass: "bg-emerald-500/15 text-emerald-300",
    textClass: "text-emerald-300",
  },
};
