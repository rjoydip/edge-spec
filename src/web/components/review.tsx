import { lazy, Suspense, useState } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  FlaskConical,
  GitPullRequest,
  List,
  ListChecks,
  Loader2,
  RefreshCw,
  TreePine,
} from "lucide-react";
import type { GeneratedTest } from "../../core/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PathTree } from "@/components/path-tree";
import { ValidationDialog } from "@/components/preview";
import { ViewTabs } from "@/components/ui/view-tabs";
import { cn } from "@/lib/utils";

// The highlighter is heavy; it arrives only when a test is opened.
const CodeView = lazy(() => import("./code-view"));

interface ReviewProps {
  items: GeneratedTest[];
  pullUrls: Record<string, string>;
  busyPath?: string;
  /** The item shown in the workbench. */
  activePath?: string;
  /** Paths whose generation is in flight right now. */
  generatingPaths?: string[];
  onPreview: (item: GeneratedTest) => void;
  /** Opens one pull request for the listed tests. */
  onOpenPull: (items: GeneratedTest[]) => void;
  /** Regenerates the test of one file. */
  onRegenerate?: (item: GeneratedTest) => void;
}

export function Review({
  items,
  pullUrls,
  busyPath,
  activePath,
  generatingPaths = [],
  onPreview,
  onOpenPull,
  onRegenerate,
}: ReviewProps) {
  const [view, setView] = useState<"list" | "file">("list");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);

  // A test that failed validation is not review material: it is shown in
  // Missing tests with its error, not here.
  const passed = items.filter((item) => item.validation.ok);
  const failedCount = items.length - passed.length;
  const ready = passed.filter((item) => !pullUrls[item.generation.sourcePath]);
  const checkedItems = ready.filter((item) => checked.has(item.generation.sourcePath));
  const busy = Boolean(busyPath);

  const active = passed.find((item) => item.generation.sourcePath === activePath) ?? passed[0];

  const toggle = (path: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const allReadyChecked =
    ready.length > 0 && ready.every((item) => checked.has(item.generation.sourcePath));
  const someChecked = checkedItems.length > 0 && !allReadyChecked;

  const setAll = (value: boolean) =>
    setChecked(value ? new Set(ready.map((item) => item.generation.sourcePath)) : new Set());

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(active?.generation.code ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The clipboard can be blocked; the code is still selectable.
    }
  };

  const download = () => {
    if (!active) return;
    const blob = new Blob([active.generation.code], { type: "text/typescript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = active.generation.testPath.split("/").pop() ?? "test.ts";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const openPull = () => onOpenPull(checkedItems.length > 0 ? checkedItems : ready);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.62fr)_minmax(0,1.9fr)]">
      <div className="glass-panel flex h-[min(78vh,48rem)] flex-col overflow-hidden rounded-2xl">
        <div className="space-y-2 border-b border-zinc-800 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-2 text-[11px] text-zinc-500">
              <ListChecks className="size-4 shrink-0 text-indigo-400" />
              <span className="truncate">
                {passed.length === 0
                  ? "No passed tests yet"
                  : `${passed.length} passed · ${ready.length} ready for a PR`}
              </span>
            </p>
            <ViewTabs
              value={view}
              onChange={(value) => setView(value as "list" | "file")}
              items={[
                { id: "list", label: "List", icon: List },
                { id: "file", label: "Files", icon: TreePine },
              ]}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-zinc-400 select-none">
              <input
                type="checkbox"
                className="size-3.5"
                checked={allReadyChecked}
                ref={(node) => {
                  if (node) node.indeterminate = someChecked;
                }}
                onChange={(event) => setAll(event.target.checked)}
                aria-label="Select every test that is ready for a pull request"
              />
              Select all
            </label>
            <span className="h-4 w-px bg-zinc-800" />
            <Button
              size="xs"
              onClick={openPull}
              disabled={ready.length === 0 || busy}
              title={
                checkedItems.length > 0
                  ? "One pull request that carries the selected tests"
                  : "One pull request that carries every test"
              }
            >
              <GitPullRequest className="size-3.5" />
              {checkedItems.length > 0
                ? `Open PR for selected (${checkedItems.length})`
                : `Raise PR for all (${ready.length})`}
            </Button>
            {checkedItems.length > 0 && (
              <button
                type="button"
                onClick={() => setChecked(new Set())}
                className="text-[11px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
              >
                Clear
              </button>
            )}
            <span className="ml-auto text-[10px] text-zinc-600">
              {checkedItems.length > 0
                ? `${checkedItems.length} selected`
                : "no selection · all validated tests"}
            </span>
          </div>
        </div>

        {passed.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-5 py-16 text-center">
            <FlaskConical className="mx-auto size-8 text-zinc-700" />
            <p className="mt-3 text-sm font-medium text-zinc-300">No passed tests yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">
              Generate a test from Missing tests. Only tests that passed validation appear here.
            </p>
          </div>
        ) : view === "file" ? (
          <div className="no-scrollbar min-h-0 flex-1 overflow-auto">
            <PathTree
              key={passed.map((item) => item.generation.sourcePath).join("|")}
              paths={passed.map((item) => item.generation.sourcePath)}
              selected={active?.generation.sourcePath}
              onSelect={(path) => {
                const item = passed.find((entry) => entry.generation.sourcePath === path);
                if (item) onPreview(item);
              }}
              decoration={(path) => {
                const item = passed.find((entry) => entry.generation.sourcePath === path);
                if (!item) return null;
                const pullUrl = pullUrls[path];
                if (pullUrl) {
                  return { text: "PR ✓", color: "#818cf8", title: "A pull request is open" };
                }
                return { text: "✓", color: "#34d399", title: "Validated test ready to review" };
              }}
              className="h-full"
            />
          </div>
        ) : (
          <ul className="no-scrollbar min-h-0 flex-1 divide-y divide-zinc-800 overflow-auto">
            {passed.map((item) => {
              const path = item.generation.sourcePath;
              const pullUrl = pullUrls[path];
              const itemBusy = generatingPaths.includes(path);
              return (
                <li
                  key={path}
                  className={cn(
                    "flex flex-col gap-3 px-5 py-4 transition md:flex-row md:items-center md:justify-between",
                    active?.generation.sourcePath === path &&
                      "bg-indigo-500/10 shadow-[inset_2px_0_0_0_var(--accent-500)]",
                  )}
                >
                  {!pullUrl && (
                    <input
                      type="checkbox"
                      className="shrink-0 self-start md:self-auto"
                      checked={checked.has(path)}
                      onChange={() => toggle(path)}
                      aria-label={`Select ${path}`}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => onPreview(item)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
                      <span className="truncate font-mono text-xs text-zinc-200">
                        {item.generation.testPath}
                      </span>
                      {pullUrl && <Badge variant="accent">PR opened</Badge>}
                      {itemBusy && <Loader2 className="size-3.5 animate-spin text-indigo-400" />}
                    </div>
                    <p className="mt-1 truncate pl-6 font-mono text-[11px] text-zinc-500">
                      for {path}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {failedCount > 0 && (
          <p className="border-t border-zinc-800 px-4 py-2 text-[10px] leading-relaxed text-amber-300/80">
            {failedCount} generated test{failedCount === 1 ? "" : "s"} did not pass validation and
            {failedCount === 1 ? " is" : " are"} hidden here — open Missing tests to see why.
          </p>
        )}
      </div>

      <div className="glass-panel flex h-[min(78vh,48rem)] min-h-0 flex-col overflow-hidden rounded-2xl">
        {!active ? (
          <div className="flex flex-1 flex-col items-center justify-center px-5 py-16 text-center">
            <FileCode2 className="size-8 text-zinc-700" />
            <p className="mt-3 text-sm font-medium text-zinc-300">Nothing to review</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">
              Pick a passed test on the left to see the original file and the generated code.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-zinc-200">
                  {active.generation.testPath}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                  for {active.generation.sourcePath} · {active.generation.model}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {active.generation.corrected && <Badge variant="warning">self-corrected</Badge>}
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setValidationOpen(true)}
                  aria-label="Validation details"
                  className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:border-emerald-400/50 hover:text-emerald-200"
                >
                  <CheckCircle2 />
                  Passed
                </Button>
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
                {onRegenerate && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => onRegenerate(active)}
                    disabled={busy || generatingPaths.includes(active.generation.sourcePath)}
                    aria-label="Regenerate test"
                    className="border-violet-500/30 bg-violet-500/10 text-violet-300 hover:border-violet-400/50 hover:text-violet-200"
                  >
                    <RefreshCw
                      className={
                        generatingPaths.includes(active.generation.sourcePath)
                          ? "animate-spin"
                          : undefined
                      }
                    />
                    Regenerate
                  </Button>
                )}
              </div>
            </div>

            <div className="grid min-h-0 flex-1 md:grid-cols-2">
              <div className="flex min-h-0 flex-col border-b border-zinc-800 md:border-r md:border-b-0">
                <div className="flex items-center gap-2 border-b border-zinc-800/70 bg-zinc-950/30 px-4 py-2">
                  <FileCode2 className="size-3.5 text-indigo-400" />
                  <span
                    className="truncate font-mono text-[11px] text-zinc-300"
                    title={active.generation.sourcePath}
                  >
                    {active.generation.sourcePath.split("/").pop()}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-zinc-600">original</span>
                </div>
                {active.generation.source ? (
                  <Suspense fallback={<CodeFallback />}>
                    <CodeView
                      path={active.generation.sourcePath}
                      code={active.generation.source}
                      className="min-h-0 flex-1"
                    />
                  </Suspense>
                ) : (
                  <div className="flex flex-1 items-center justify-center p-6 text-center text-[11px] text-zinc-500">
                    The original file was not included with this generation. Regenerate the test to
                    load it.
                  </div>
                )}
              </div>

              <div className="flex min-h-0 flex-col">
                <div className="flex items-center gap-2 border-b border-zinc-800/70 bg-zinc-950/30 px-4 py-2">
                  <FileCode2 className="size-3.5 text-emerald-400" />
                  <span className="truncate font-mono text-[11px] text-zinc-300">
                    {active.generation.testPath.split("/").pop()}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-zinc-600">new file</span>
                </div>
                <Suspense fallback={<CodeFallback />}>
                  <CodeView
                    path={active.generation.testPath}
                    code={active.generation.code}
                    className="min-h-0 flex-1"
                  />
                </Suspense>
              </div>
            </div>
            <ValidationDialog
              open={validationOpen}
              onClose={() => setValidationOpen(false)}
              validation={active.validation}
            />
          </>
        )}
      </div>
    </div>
  );
}

function CodeFallback() {
  return (
    <div className="flex-1 animate-pulse bg-zinc-950/70 p-4 font-mono text-[11px] text-zinc-600">
      loading the highlighter…
    </div>
  );
}
