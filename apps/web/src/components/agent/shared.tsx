/** Shared atoms for the agent workspace: stage tones, badges, checks, downloads. */
import { Check, CheckCircle2, TriangleAlert, Wrench, X } from "lucide-react";
import { Badge, Hint, cn } from "@edge-spec/ui";
import type {
  ApiTestResult,
  CheckResult,
  CoverageDelta,
  Generation,
  StepId,
  Validation,
} from "@edge-spec/core/types";

export interface AgentTest {
  generation: Generation;
  validation: Validation;
}

export type ReviewState = "pending" | "accepted" | "rejected";
export type ValidationFilter = "all" | "passed" | "failed" | "static";
export type StageKey = "clone" | "analyze" | "test" | "fix";
export type StepStatus = "idle" | "running" | "done" | "failed";
export type Steps = Record<StepId, { status: StepStatus; note?: string }>;
export type Verification = "none" | "verified" | "static" | "failed";
export type LogLevel = "info" | "ai" | "warn" | "success" | "error";

export interface LogEntry {
  id: number;
  level: LogLevel;
  time: string;
  text: string;
  /** The pipeline stage that produced the entry; gap logs leave it unset. */
  step?: StepId;
}

export const INITIAL_STEPS: Steps = {
  scan: { status: "idle" },
  generate: { status: "idle" },
  validate: { status: "idle" },
  correct: { status: "idle" },
  "pull-request": { status: "idle" },
};

export const ICON_GRADIENT = "url(#edge-icon-gradient)";

/** One document-level gradient so icon strokes can use it. */
export function IconGradientDefs() {
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" className="absolute">
      <defs>
        <linearGradient id="edge-icon-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="var(--color-indigo-400, #818cf8)" />
          <stop offset="1" stopColor="var(--color-violet-400, #a78bfa)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

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

export const METHOD = {
  GET: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  POST: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  PUT: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  PATCH: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  DELETE: "border-rose-500/30 bg-rose-500/10 text-rose-400",
} as const;

export function MethodChip({ method }: { method: string }) {
  const tone = METHOD[method.toUpperCase() as keyof typeof METHOD] ?? METHOD.GET;
  return (
    <span
      className={cn(
        "inline-flex w-14 shrink-0 justify-center rounded border px-1 py-0.5 font-mono text-[9px] font-bold",
        tone,
      )}
    >
      {method.toUpperCase()}
    </span>
  );
}

export function EndpointStatus({ result }: { result?: ApiTestResult }) {
  if (!result) {
    return (
      <Badge variant="neutral" className="gap-1">
        Not run
      </Badge>
    );
  }
  if (result.status === "passed") {
    return (
      <Badge variant="success" className="gap-1">
        <Check className="size-3" />
        {result.httpStatus ?? "ok"}
      </Badge>
    );
  }
  if (result.status === "failed") {
    return (
      <Badge variant="danger" className="gap-1">
        <X className="size-3" />
        {result.httpStatus ?? "failed"}
      </Badge>
    );
  }
  if (result.status === "skipped") {
    return (
      <Badge variant="warning" className="gap-1">
        <TriangleAlert className="size-3" />
        skipped
      </Badge>
    );
  }
  return <Badge variant="neutral">Not run</Badge>;
}

function checkStatus(check: CheckResult): "passed" | "failed" | "warning" {
  if (check.skipped) return "warning";
  return check.ok ? "passed" : "failed";
}

/** One dot per real repository check, or one for the suite result. */
export function CheckSummary({ validation }: { validation: Validation }) {
  const checks = validation.checks ?? [];
  if (checks.length === 0) {
    const status = validation.ok ? (validation.verified ? "passed" : "warning") : "failed";
    return (
      <Hint
        label={
          validation.ok
            ? validation.verified
              ? "Executed on the runner"
              : "Static check only — no runner executed the suite"
            : "Validation failed"
        }
      >
        <span
          className={cn(
            "inline-block size-2 rounded-full",
            status === "passed"
              ? "bg-emerald-400"
              : status === "warning"
                ? "bg-amber-400"
                : "bg-rose-500",
          )}
          aria-label="Validation status"
        />
      </Hint>
    );
  }
  const dots = {
    passed: "bg-emerald-400",
    failed: "bg-rose-500",
    warning: "bg-amber-400",
  };
  return (
    <Hint
      label={checks
        .map(
          (check) => `${check.kind}: ${check.skipped ? "skipped" : check.ok ? "passed" : "failed"}`,
        )
        .join(" · ")}
    >
      <span className="inline-flex items-center gap-1" aria-label="Check results">
        {checks.map((check) => (
          <span
            key={`${check.kind}-${check.name}`}
            className={cn("size-2 rounded-full", dots[checkStatus(check)])}
          />
        ))}
      </span>
    </Hint>
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

/** Downloads generated text as a real file. */
export function downloadFile(name: string, content: string, type = "text/plain"): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function outputSummary(output: string, max = 320): string {
  const text = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" · ");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function coverageLabel(status?: "not-run" | "unavailable" | "measured"): string {
  if (status === "measured") return "Measured";
  if (status === "unavailable") return "Unavailable";
  return "Not run";
}

export function verificationLabel(validation: Validation): string {
  if (!validation.ok) return "Validation failed";
  return validation.verified ? "Executed on the runner" : "Static check only";
}

export function verificationVariant(validation: Validation): "success" | "warning" | "danger" {
  if (!validation.ok) return "danger";
  return validation.verified ? "success" : "warning";
}

/** A compact delta for the review row; absence means it was not measured. */
export function coverageDeltaLabel(delta?: CoverageDelta): string {
  if (!delta || delta.status !== "measured") return "coverage not measured";
  const lines = delta.lines.delta;
  return `coverage ${lines >= 0 ? "+" : ""}${lines} lines`;
}

/** One pull-request body line for a measured delta; empty when not measured. */
export function coverageBodyLine(sourcePath: string, delta?: CoverageDelta): string {
  if (!delta || delta.status !== "measured") return "";
  const signed = (value: number) => (value >= 0 ? `+${value}` : `${value}`);
  const branches = delta.branches ? `, branches ${signed(delta.branches.delta)}` : "";
  return `- \`${sourcePath}\`: ${signed(delta.lines.delta)} covered line(s)${branches} (${delta.lines.after}/${delta.lines.total}).`;
}

export function skippedChecks(validation: Validation): number {
  return (validation.checks ?? []).filter((check) => check.skipped).length;
}

export function failedChecks(validation: Validation): number {
  return (validation.checks ?? []).filter((check) => !check.ok && !check.skipped).length;
}

export function CheckIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 className="size-3.5 text-emerald-400" />
  ) : (
    <Wrench className="size-3.5 text-amber-400" />
  );
}
