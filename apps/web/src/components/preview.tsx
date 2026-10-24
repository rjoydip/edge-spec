/**
 * The preview pane. It shows one file: the gap it fills, the test the model
 * wrote for it, the validation result and the checks it passed. The dashboard
 * keeps it beside the gap list and beside the review list, so nothing needs its
 * own tab.
 */
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  Info,
  Loader2,
  Minus,
  RefreshCw,
  Sparkles,
  Terminal,
  X,
  XCircle,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";
import type { Gap, Generation, Validation } from "@edge-spec/core/types";
import { Badge, Button, Dialog, cn } from "@edge-spec/ui";
import { CHECK_TONES } from "@/lib/check-tones";

// The highlighter and its grammars are heavy, and only a generated test needs
// them, so they arrive on demand.
const CodeView = lazy(() => import("./code-view"));

const RISK = {
  high: { variant: "danger" as const, label: "high risk" },
  medium: { variant: "warning" as const, label: "medium risk" },
  low: { variant: "neutral" as const, label: "low risk" },
};

interface PreviewProps {
  /** The file the reader is looking at, before a test exists. */
  gap?: Gap;
  generation?: Generation;
  validation?: Validation;
  pullUrl?: string;
  /** A generation is running for this file. */
  busy?: boolean;
  /** The last generation of this file failed. */
  error?: string;
  /** "code" shows the test, "meta" shows what the file is missing. */
  mode?: "code" | "meta";
  onRegenerate?: () => void;
  /** Fixes every failure in the current validation result. */
  onCorrect?: () => void;
  correcting?: boolean;
  /** Shown when nothing is selected. */
  placeholder?: string;
}

export function Preview({
  gap,
  generation,
  validation,
  pullUrl,
  busy,
  error,
  mode = "code",
  onRegenerate,
  onCorrect,
  correcting,
  placeholder = "Select a file to preview its test.",
}: PreviewProps) {
  const [copied, setCopied] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(generation?.code ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The clipboard can be blocked; the code is still selectable.
    }
  };

  const download = () => {
    const blob = new Blob([generation?.code ?? ""], { type: "text/typescript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (generation?.testPath ?? "test.ts").split("/").pop() ?? "test.ts";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // Nothing selected yet.
  if (!generation && !gap) {
    return (
      <div className="glass-panel flex h-[min(70vh,40rem)] flex-col overflow-hidden rounded-2xl">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
          <FileCode2 className="size-4 shrink-0 text-indigo-400" />
          <p className="truncate text-[11px] text-zinc-500">Preview</p>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-5 py-14 text-center">
          <Terminal className="size-8 text-zinc-700" />
          <p className="mt-3 text-sm font-medium text-zinc-300">
            {busy ? "Generating a test…" : "Nothing to preview"}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">
            {busy
              ? "The model is writing the test. It lands here when the check finishes."
              : placeholder}
          </p>
        </div>
      </div>
    );
  }

  // The reader asked for the file itself rather than its test.
  if (mode === "meta" && gap) {
    const file = gap;
    const risk = RISK[file.risk];
    return (
      <div className="glass-panel flex h-[min(70vh,40rem)] flex-col overflow-hidden rounded-2xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
          <p className="truncate font-mono text-xs text-zinc-200">{file.path}</p>
          <Badge variant={risk.variant}>{risk.label}</Badge>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          {error && (
            <p className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-200/90">
              The last generation failed: {error}
            </p>
          )}
          <div>
            <h3 className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
              <Info className="size-4 text-indigo-400" />
              Why this file needs a test
            </h3>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">{file.reason}</p>
            <p className="mt-2 font-mono text-[11px] text-zinc-500">
              expected test: <span className="text-zinc-400">{file.testPath}</span>
            </p>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-zinc-200">Uncovered functions</h3>
            {file.exports.length === 0 ? (
              <p className="mt-2 text-[11px] text-zinc-500">
                No exported symbols were detected in this file.
              </p>
            ) : (
              <>
                <p className="mt-1 text-[11px] text-zinc-500">
                  {file.exports.length} exported symbol
                  {file.exports.length === 1 ? "" : "s"} without a test next to them.
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {file.exports.map((name) => (
                    <li
                      key={name}
                      className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
                    >
                      {name}()
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold text-zinc-200">Metadata</h3>
            <dl className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Source</dt>
                <dd className="mt-0.5 truncate font-mono text-[11px] text-zinc-300">{file.path}</dd>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Risk</dt>
                <dd className="mt-0.5 font-mono text-[11px] text-zinc-300">{file.risk}</dd>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Exports</dt>
                <dd className="mt-0.5 font-mono text-[11px] text-zinc-300">
                  {file.exports.length}
                </dd>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Test</dt>
                <dd className="mt-0.5 truncate font-mono text-[11px] text-zinc-300">
                  {file.testPath}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <p className="border-t border-zinc-800 px-4 py-3 text-[10px] leading-relaxed text-zinc-500">
          The sparkles icon in the list generates a test for this file.
        </p>
      </div>
    );
  }

  // The file is known, but no test has been written for it yet.
  if (!generation) {
    // The empty state above returned when there was neither a gap nor a test.
    const file = gap as Gap;
    const risk = RISK[file.risk];
    return (
      <div className="glass-panel flex h-[min(70vh,40rem)] flex-col overflow-hidden rounded-2xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
          <p className="truncate font-mono text-xs text-zinc-200">{file.path}</p>
          <Badge variant={risk.variant}>{risk.label}</Badge>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          {error && (
            <p className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-200/90">
              The last generation failed: {error}
            </p>
          )}
          <div>
            <h3 className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
              <Info className="size-4 text-indigo-400" />
              Why this file needs a test
            </h3>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">{file.reason}</p>
            <p className="mt-2 font-mono text-[11px] text-zinc-500">
              expected test: <span className="text-zinc-400">{file.testPath}</span>
            </p>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-zinc-200">Uncovered functions</h3>
            {file.exports.length === 0 ? (
              <p className="mt-2 text-[11px] text-zinc-500">
                No exported symbols were detected in this file.
              </p>
            ) : (
              <>
                <p className="mt-1 text-[11px] text-zinc-500">
                  {file.exports.length} exported symbol
                  {file.exports.length === 1 ? "" : "s"} without a test next to them.
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {file.exports.map((name) => (
                    <li
                      key={name}
                      className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
                    >
                      {name}()
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold text-zinc-200">Metadata</h3>
            <dl className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Source</dt>
                <dd className="mt-0.5 truncate font-mono text-[11px] text-zinc-300">{file.path}</dd>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Risk</dt>
                <dd className="mt-0.5 font-mono text-[11px] text-zinc-300">{file.risk}</dd>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Exports</dt>
                <dd className="mt-0.5 font-mono text-[11px] text-zinc-300">
                  {file.exports.length}
                </dd>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Test</dt>
                <dd className="mt-0.5 truncate font-mono text-[11px] text-zinc-300">
                  {file.testPath}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <p className="border-t border-zinc-800 px-4 py-3 text-[10px] leading-relaxed text-zinc-500">
          The sparkles icon in the list generates a test for this file. It is written, checked and
          then waits in Review.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-panel flex h-[min(70vh,40rem)] flex-col overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-zinc-200">{generation.testPath}</p>
          <p className="mt-0.5 truncate text-[11px] text-zinc-500">
            for {generation.sourcePath} · {generation.model}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {generation.corrected && <Badge variant="warning">self-corrected</Badge>}
          {pullUrl && <Badge variant="accent">PR opened</Badge>}
          <Button
            variant="outline"
            size="xs"
            onClick={copy}
            aria-label="Copy test code"
            className="border-sky-500/30 bg-sky-500/10 text-sky-300 hover:border-sky-400/50 hover:text-sky-200"
          >
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={download}
            aria-label="Download test file"
            className="border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:border-cyan-400/50 hover:text-cyan-200"
          >
            <Download />
            Download
          </Button>
          {validation && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => setDetailsOpen(true)}
              aria-label="Validation details"
              className={cn(
                validation.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:border-emerald-400/50 hover:text-emerald-200"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:border-amber-400/60 hover:text-amber-200",
              )}
            >
              {validation.ok ? <CheckCircle2 /> : <XCircle />}
              {validation.ok ? "Passed" : "Failed"}
            </Button>
          )}
          {onRegenerate && (
            <Button
              variant="outline"
              size="xs"
              onClick={onRegenerate}
              disabled={busy}
              aria-label="Regenerate test"
              className="border-violet-500/30 bg-violet-500/10 text-violet-300 hover:border-violet-400/50 hover:text-violet-200"
            >
              <RefreshCw className={busy ? "animate-spin" : undefined} />
              {busy ? "Generating…" : "Regenerate"}
            </Button>
          )}
        </div>
      </div>

      <Suspense
        fallback={
          <div className="max-h-[26rem] flex-1 animate-pulse bg-zinc-950/70 p-4 font-mono text-[11px] text-zinc-600">
            loading the highlighter…
          </div>
        }
      >
        <CodeView path={generation.testPath} code={generation.code} className="max-h-[26rem]" />
      </Suspense>
      <ValidationDialog
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        validation={validation}
        {...(onCorrect ? { onCorrect } : {})}
        {...(correcting ? { correcting } : {})}
      />
    </div>
  );
}

/** The validation result and its checks, shared by every place that shows a test. */
export function ValidationDialog({
  open,
  onClose,
  validation,
  onCorrect,
  correcting,
}: {
  open: boolean;
  onClose: () => void;
  validation?: Validation;
  onCorrect?: () => void;
  correcting?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Validation"
      description="What ran against this test, and what it found."
      className="modal-content"
      {...(onCorrect && validation && !validation.ok
        ? {
            footer: (
              <>
                <p className="mr-auto max-w-xs text-[10px] leading-relaxed text-zinc-500">
                  Every failure above goes back to the model. It rewrites the test, then all checks
                  run again.
                </p>
                <Button size="sm" onClick={onCorrect} disabled={correcting}>
                  {correcting ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  {correcting ? "Fixing…" : "Fix all with self-correct"}
                </Button>
              </>
            ),
          }
        : {})}
    >
      <div className="space-y-3 p-4">
        <ValidationSummary validation={validation} />
        <CheckList validation={validation} />
        {validation?.output && (
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/40">
            <div className="flex items-center justify-between gap-2 border-b border-zinc-800/60 px-3 py-2">
              <p className="text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
                Raw output
              </p>
              <span className="font-mono text-[10px] text-zinc-600">
                {validation.output.split("\n").length} lines
              </span>
            </div>
            <pre className="no-scrollbar max-h-48 overflow-auto p-3 font-mono text-[10px] whitespace-pre-wrap text-zinc-400">
              {validation.output}
            </pre>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function ValidationSummary({ validation }: { validation?: Validation }) {
  const checks = validation?.checks ?? [];
  const passed = checks.filter((check) => check.ok).length;
  const failed = checks.filter((check) => !check.ok && !check.skipped).length;
  const skipped = checks.filter((check) => check.skipped).length;

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div
        className={cn(
          "flex size-9 items-center justify-center rounded-full",
          validation?.ok
            ? "bg-emerald-500/10 text-emerald-400"
            : validation
              ? "bg-rose-500/10 text-rose-400"
              : "bg-zinc-800/40 text-zinc-500",
        )}
      >
        {validation?.ok ? (
          <CheckCircle2 className="size-5" />
        ) : validation ? (
          <XCircle className="size-5" />
        ) : (
          <Terminal className="size-5" />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-zinc-100">
          {validation?.ok
            ? "All checks passed"
            : validation
              ? "Validation failed"
              : "Not validated yet"}
        </p>
        <p className="text-[11px] text-zinc-400">
          {validation
            ? `${validation.verified ? "bun test executed" : "static analysis only"} · ${validation.durationMs} ms`
            : "Generate a test to see its checks."}
        </p>
      </div>
      {checks.length > 0 && (
        <div className="ml-auto flex items-center gap-1.5 font-mono text-[10px]">
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
            {passed} passed
          </span>
          {failed > 0 && (
            <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-rose-300">
              {failed} failed
            </span>
          )}
          {skipped > 0 && (
            <span className="rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-zinc-400">
              {skipped} skipped
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function CheckList({ validation }: { validation?: Validation }) {
  const checks = validation?.checks ?? [];

  if (checks.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-2.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-lg",
              validation?.ok
                ? "bg-emerald-500/15 text-emerald-300"
                : validation
                  ? "bg-rose-500/15 text-rose-300"
                  : "bg-zinc-800/60 text-zinc-400",
            )}
          >
            {validation?.ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-zinc-200">Static analysis</p>
            <p className="text-[10px] text-zinc-500">
              {validation?.ok
                ? "Syntax, test structure and assertions passed."
                : "The file did not pass the static checks."}
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 font-mono text-[10px]",
              validation?.ok ? "text-emerald-400" : "text-rose-400",
            )}
          >
            {validation?.ok ? "passed" : "failed"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
        CI checks · {checks.length}
      </p>
      <ul className="space-y-2">
        {checks.map((check) => {
          const tone = CHECK_TONES[check.kind] ?? CHECK_TONES.test!;
          const Icon = tone.icon;
          const state = check.skipped ? "skipped" : check.ok ? "passed" : "failed";
          return (
            <li
              key={check.command}
              className={cn(
                "rounded-xl border p-2.5",
                state === "failed"
                  ? "border-rose-500/25 bg-rose-500/5"
                  : state === "skipped"
                    ? "border-zinc-800/70 bg-zinc-950/40"
                    : "border-zinc-800/70 bg-zinc-950/40",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-lg",
                    tone.iconClass,
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-semibold text-zinc-200">{check.name}</p>
                  <p className={cn("font-mono text-[10px]", tone.textClass)}>{check.kind}</p>
                </div>
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px]",
                    state === "passed"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : state === "failed"
                        ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                        : "border-zinc-700 bg-zinc-800/60 text-zinc-400",
                  )}
                >
                  {state === "passed" ? (
                    <Check className="size-3" />
                  ) : state === "skipped" ? (
                    <Minus className="size-3" />
                  ) : (
                    <X className="size-3" />
                  )}
                  {state === "passed" ? "Passed" : state === "skipped" ? "Skipped" : "Failed"}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/60 pt-2">
                <code className="truncate font-mono text-[10px] text-zinc-400">
                  {check.command}
                </code>
                <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                  {check.durationMs} ms ·{" "}
                  {state === "passed"
                    ? "check succeeded"
                    : state === "skipped"
                      ? "tool not available in the sandbox"
                      : "check failed"}
                </span>
              </div>
              {state === "failed" && check.output && (
                <pre className="no-scrollbar mt-2 max-h-32 overflow-auto rounded-lg border border-rose-500/20 bg-rose-500/5 p-2 font-mono text-[9px] whitespace-pre-wrap text-rose-300/90">
                  {check.output.slice(0, 1600)}
                </pre>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
