/** Shared atoms for the draft: stage tones, badges, checks, downloads. */
import { Check, CheckCircle2, TriangleAlert, Wrench, X } from "lucide-react";
import { Badge, cn, type BadgeProps } from "@edge-spec/ui";
import type { DraftEndpoint, EndpointLog, LogLine } from "./data";

export const TONES = {
  clone: {
    text: "text-stage-clone",
    border: "border-stage-clone/35",
    soft: "bg-stage-clone/10",
    bar: "bg-stage-clone",
    glow: "shadow-stage-clone/20",
  },
  analyze: {
    text: "text-stage-analyze",
    border: "border-stage-analyze/35",
    soft: "bg-stage-analyze/10",
    bar: "bg-stage-analyze",
    glow: "shadow-stage-analyze/20",
  },
  test: {
    text: "text-stage-test",
    border: "border-stage-test/35",
    soft: "bg-stage-test/10",
    bar: "bg-stage-test",
    glow: "shadow-stage-test/20",
  },
  fix: {
    text: "text-stage-fix",
    border: "border-stage-fix/35",
    soft: "bg-stage-fix/10",
    bar: "bg-stage-fix",
    glow: "shadow-stage-fix/20",
  },
  review: {
    text: "text-stage-review",
    border: "border-stage-review/35",
    soft: "bg-stage-review/10",
    bar: "bg-stage-review",
    glow: "shadow-stage-review/20",
  },
} as const;

export type Tone = keyof typeof TONES;

export const STAGE_LABEL: Record<"clone" | "analyze" | "test" | "fix", string> = {
  clone: "Clone & parse",
  analyze: "Gap analysis",
  test: "Contract tests",
  fix: "Fix & generate",
};

export const METHOD = {
  GET: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  POST: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  PUT: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  PATCH: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  DELETE: "border-rose-500/30 bg-rose-500/10 text-rose-400",
} as const;

export const RISK = {
  high: { variant: "danger" as const, label: "H" },
  medium: { variant: "warning" as const, label: "M" },
  low: { variant: "neutral" as const, label: "L" },
};

export const LEVEL_CLASS: Record<string, string> = {
  info: "text-zinc-400",
  ai: "text-violet-300",
  warn: "text-amber-400",
  success: "text-emerald-400",
  error: "text-rose-400",
};

export function MethodChip({
  method,
  className,
}: {
  method: DraftEndpoint["method"];
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-14 shrink-0 justify-center rounded border px-1 py-0.5 font-mono text-[9px] font-bold",
        METHOD[method],
        className,
      )}
    >
      {method}
    </span>
  );
}

export function CheckChips({ checks }: { checks: ReadonlyArray<{ kind: string; ok: boolean }> }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {checks.map((check) => (
        <span
          key={check.kind}
          title={`${check.kind}: ${check.ok ? "passed" : "failed"}`}
          className={cn(
            "inline-flex items-center gap-0.5 rounded border px-1 py-0.5 font-mono text-[9px]",
            check.ok
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
              : "border-rose-500/30 bg-rose-500/10 text-rose-400",
          )}
        >
          {check.ok ? <Check className="size-2.5" /> : <X className="size-2.5" />}
          {check.kind}
        </span>
      ))}
    </span>
  );
}

export interface EndpointRow extends DraftEndpoint {
  visible?: boolean;
  wasHttp?: number;
}

export function EndpointStatus({ row }: { row: EndpointRow }) {
  const fixed =
    row.firstHttp !== undefined && row.firstHttp !== row.http && row.outcome !== "skipped";
  if (row.outcome === "skipped") {
    return (
      <Badge variant="warning" className="gap-1">
        <TriangleAlert className="size-3" />
        skipped
      </Badge>
    );
  }
  if (fixed) {
    return (
      <Badge variant="success" className="gap-1">
        <Wrench className="size-3" />
        {row.firstHttp} → {row.http}
      </Badge>
    );
  }
  if (row.http >= 500) {
    return (
      <Badge variant="danger" className="gap-1">
        <X className="size-3" />
        {row.http} error
      </Badge>
    );
  }
  if (row.http >= 400) {
    return (
      <Badge variant="warning" className="gap-1">
        <TriangleAlert className="size-3" />
        {row.http}
      </Badge>
    );
  }
  return (
    <Badge variant="success" className="gap-1">
      <Check className="size-3" />
      {row.http} ok
    </Badge>
  );
}

export function LogLines({
  lines,
  empty = "No events yet.",
}: {
  lines: Array<LogLine | EndpointLog>;
  empty?: string;
}) {
  if (lines.length === 0) {
    return <p className="py-6 text-center text-[11px] text-zinc-600">{empty}</p>;
  }
  return (
    <div className="space-y-1 font-mono text-[11px] leading-relaxed">
      {lines.map((line, index) => (
        <p key={index} className="flex gap-2">
          <span className="shrink-0 text-zinc-600">{line.at}</span>
          {"stage" in line && (
            <span className="w-14 shrink-0 truncate text-[9px] tracking-wide text-zinc-600 uppercase">
              {line.stage}
            </span>
          )}
          <span className={cn("min-w-0 break-words", LEVEL_CLASS[line.level])}>{line.text}</span>
        </p>
      ))}
    </div>
  );
}

export function DiffLines({ lines, capped = 30 }: { lines: string[]; capped?: number }) {
  return (
    <div className="py-1">
      {lines.map((line, index) => {
        const blank = line.trim() === "";
        return (
          <div
            key={index}
            className={cn(
              "diff-line flex gap-3 px-3 font-mono text-[11px] leading-5",
              !blank && "bg-emerald-500/[0.06]",
            )}
            style={{ animationDelay: `${Math.min(index, capped) * 12}ms` }}
          >
            <span className="w-6 shrink-0 text-right text-[10px] text-zinc-500 select-none">
              {index + 1}
            </span>
            <span className={cn("w-2 shrink-0", blank ? "text-zinc-600" : "text-emerald-400")}>
              {blank ? "" : "+"}
            </span>
            <span className="min-w-0 whitespace-pre-wrap break-words text-zinc-300">
              {line || " "}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Downloads a fixture as a real file. The draft has no server to talk to. */
export function downloadFile(name: string, content: string, type = "text/plain"): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function testFileName(path: string): string {
  return path.replace(/.*\//, "");
}

export function toneForStatus(ok: boolean): BadgeProps["variant"] {
  return ok ? "success" : "danger";
}

export function CheckIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 className="size-3.5 text-emerald-400" />
  ) : (
    <TriangleAlert className="size-3.5 text-amber-400" />
  );
}
