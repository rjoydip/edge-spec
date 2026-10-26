/** Every modal the agent workspace opens. Real data only. */
import { useEffect, useState, type ReactNode } from "react";
import {
  AlignLeft,
  Check,
  CheckCircle2,
  Clipboard,
  Cpu,
  FileCode2,
  FileDiff,
  FileJson,
  FlaskConical,
  FolderGit2,
  GitPullRequest,
  HardDriveDownload,
  ListChecks,
  Loader2,
  Package,
  Palette,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Timer,
  Trash2,
  TriangleAlert,
  Type,
  Wrench,
  X,
} from "lucide-react";
import { providerById } from "@edge-spec/core/catalog";
import { compareRuns, type RunComparison, type RunSummary } from "@edge-spec/core/history";
import { pullRequestBody } from "@edge-spec/core/provenance";
import type {
  ApiTestResult,
  OpenApiEndpoint,
  OpenApiSpec,
  RepositoryOverview,
  StepId,
} from "@edge-spec/core/types";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Dialog,
  Hint,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  cn,
} from "@edge-spec/ui";
import type { BacklogItem, BacklogState } from "@edge-spec/core/backlog";
import {
  deleteRuns,
  fetchBacklog,
  fetchRunArtifacts,
  fetchRunDetail,
  fetchRuns,
  updateBacklog,
} from "@/api";
import type { Project, Settings } from "@/lib/settings";
import { HighlightedCode } from "./highlight";
import {
  CheckSummary,
  EndpointStatus,
  coverageDeltaLabel,
  coverageLabel,
  mutationSummary,
  provenanceFiles,
  skippedOperationsOf,
  ICON_GRADIENT,
  MethodChip,
  downloadFile,
  failedChecks,
  skippedChecks,
  verificationLabel,
  type AgentTest,
  type LogEntry,
  type LogLevel,
  type ReviewState,
} from "./shared";

export interface ReviewEntry {
  item: AgentTest;
  state: ReviewState;
}

export interface PrDraft {
  title: string;
  branch: string;
  commit: string;
  description: string;
  draft: boolean;
}

const STEP_LABEL: Record<StepId, string> = {
  scan: "Cloned Repo",
  generate: "Fixing & Generating",
  validate: "Testing OpenSpec",
  correct: "Self-correct",
  "pull-request": "Pull request",
};

const STEP_ORDER: StepId[] = ["scan", "generate", "validate", "correct", "pull-request"];

export function LogDialog({
  open,
  onClose,
  logs,
  step,
  onStep,
}: {
  open: boolean;
  onClose: () => void;
  logs: LogEntry[];
  step: StepId | "all";
  onStep: (step: StepId | "all") => void;
}) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<"all" | LogLevel>("all");
  const inStep = step === "all" ? logs : logs.filter((line) => line.step === step);
  const needle = query.trim().toLowerCase();
  const shown = inStep.filter(
    (line) =>
      (level === "all" || line.level === level) &&
      (!needle || line.text.toLowerCase().includes(needle) || line.level.includes(needle)),
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={step === "all" ? "Event log" : `${STEP_LABEL[step]} events`}
      description={`${logs.length} events · filter by stage, level or text.`}
      className="max-w-3xl"
      actions={
        <Hint label="Download log">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Download log"
            onClick={() =>
              downloadFile(
                "edgespec-run.log",
                shown
                  .map((line) => `${line.time} [${line.step ?? "run"}] ${line.level} ${line.text}`)
                  .join("\n"),
              )
            }
          >
            <HardDriveDownload className="size-4" stroke={ICON_GRADIENT} />
          </Button>
        </Hint>
      }
    >
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-zinc-500" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search events or messages…"
            aria-label="Search log events"
            className="h-8 pl-8 text-[11px]"
          />
        </div>
        <Select value={level} onValueChange={(value) => setLevel(value as typeof level)}>
          <SelectTrigger className="h-8 w-32 text-[11px]" aria-label="Filter by log level">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            <SelectItem value="info">info</SelectItem>
            <SelectItem value="ai">ai</SelectItem>
            <SelectItem value="warn">warn</SelectItem>
            <SelectItem value="success">success</SelectItem>
            <SelectItem value="error">error</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="neutral" className="font-mono">
          {shown.length}/{inStep.length}
        </Badge>
      </div>
      <Tabs
        value={step}
        onValueChange={(value) => onStep(value as StepId | "all")}
        className="space-y-3"
      >
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="all">All · {logs.length}</TabsTrigger>
          {STEP_ORDER.filter((id) => logs.some((line) => line.step === id)).map((id) => (
            <TabsTrigger key={id} value={id}>
              {STEP_LABEL[id]} · {logs.filter((line) => line.step === id).length}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={step}>
          <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/60 p-3">
            <LogLines lines={shown} />
          </div>
        </TabsContent>
      </Tabs>
    </Dialog>
  );
}

export function DiffDialog({
  open,
  onClose,
  entry,
}: {
  open: boolean;
  onClose: () => void;
  entry?: ReviewEntry;
}) {
  if (!entry) return null;
  const { generation } = entry.item;
  const diff = generation.code.split("\n");
  const added = diff.filter((line) => line.trim() !== "").length;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={generation.testPath}
      description={`New test file generated from ${generation.sourcePath}`}
      className="max-w-3xl"
      actions={
        <Hint label="Download test">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Download test"
            onClick={() =>
              downloadFile(
                generation.testPath.split("/").pop() ?? "test.ts",
                generation.code,
                "text/typescript",
              )
            }
          >
            <HardDriveDownload className="size-4" stroke={ICON_GRADIENT} />
          </Button>
        </Hint>
      }
    >
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">+{added} additions</Badge>
          <Badge variant="neutral">−0 deletions</Badge>
          <Badge variant="neutral">new file</Badge>
          <span className="ml-auto truncate font-mono text-[10px] text-zinc-500">
            {generation.sourcePath} → {generation.testPath}
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-1.5 font-mono text-[10px] text-zinc-500">
          <FileDiff className="size-3.5 text-zinc-400" />
          @@ -0,0 +1,{diff.length} @@
          <span className="ml-auto">{added} lines added</span>
        </div>
        <CodeBlock lines={diff} kind="add" />
        <p className="text-[10px] leading-relaxed text-zinc-500">
          Diff view only. Checks, acceptance and file metadata live in the row and in the source
          view.
        </p>
      </div>
    </Dialog>
  );
}

export function SourceDialog({
  open,
  onClose,
  entry,
  onState,
  onGenerate,
  regenerating,
  onViewDiff,
}: {
  open: boolean;
  onClose: () => void;
  entry?: ReviewEntry;
  onState: (state: ReviewState) => void;
  onGenerate: () => void;
  regenerating: boolean;
  onViewDiff: () => void;
}) {
  if (!entry) return null;
  const { generation, validation } = entry.item;
  const state = entry.state;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={generation.testPath}
      description={`Compare the source and the generated test for ${generation.sourcePath}`}
      className="max-w-5xl"
      footer={
        <>
          <Button variant="outline" size="sm" className="mr-auto" onClick={onViewDiff}>
            <FileDiff className="size-3.5" stroke={ICON_GRADIENT} />
            View diff
          </Button>
          <Button variant="outline" size="sm" onClick={onGenerate} disabled={regenerating}>
            <RefreshCw className={cn("size-3.5 text-sky-400", regenerating && "animate-spin")} />
            {regenerating ? "Generating…" : "Generate test"}
          </Button>
          {state === "rejected" ? (
            <Button variant="outline" size="sm" onClick={() => onState("pending")}>
              <RotateCcw className="size-3.5" />
              Restore
            </Button>
          ) : (
            <Button variant="danger" size="sm" onClick={() => onState("rejected")}>
              <X className="size-3.5" />
              Reject
            </Button>
          )}
          <Button
            size="sm"
            variant={state === "accepted" ? "secondary" : "default"}
            onClick={() => onState("accepted")}
            disabled={state === "accepted" || !validation.ok}
            title={validation.ok ? "Accept this test" : "A failing test cannot be accepted"}
          >
            <Check className="size-3.5" />
            {state === "accepted" ? "Accepted" : "Accept"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral" className="font-mono">
            {generation.sourcePath}
          </Badge>
          <Badge variant="neutral">
            {providerById(generation.provider)?.name ?? generation.provider} · {generation.model}
          </Badge>
          <CheckSummary validation={validation} />
          {validation.flaky && <Badge variant="warning">flaky · quarantined</Badge>}
          {validation.coverage && (
            <Badge variant="neutral">{coverageDeltaLabel(validation.coverage)}</Badge>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label="Verification details"
              >
                {validation.ok ? (
                  validation.verified ? (
                    <ShieldCheck className="size-3.5 text-emerald-400" />
                  ) : (
                    <TriangleAlert className="size-3.5 text-amber-400" />
                  )
                ) : (
                  <X className="size-3.5 text-rose-400" />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80">
              <div className="flex items-center gap-1.5">
                {validation.ok ? (
                  validation.verified ? (
                    <ShieldCheck className="size-3.5 text-emerald-400" />
                  ) : (
                    <TriangleAlert className="size-3.5 text-amber-400" />
                  )
                ) : (
                  <X className="size-3.5 text-rose-400" />
                )}
                <p className="text-[11px] font-semibold text-zinc-200">
                  {verificationLabel(validation)}
                </p>
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
                {validation.ok
                  ? validation.verified
                    ? "The suite executed in the runner."
                    : "No runner executed the suite; this is a static check, not a pass."
                  : "The suite did not pass. Regenerate it or reject the file."}
              </p>
              <p className="mt-1 font-mono text-[9px] text-zinc-500">
                {validation.durationMs}ms · {validation.checks?.length ?? 0} check(s)
              </p>
              {validation.output && (
                <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-zinc-800/70 bg-zinc-950/60 p-2 font-mono text-[9px] leading-relaxed whitespace-pre-wrap text-zinc-400">
                  {validation.output}
                </pre>
              )}
            </PopoverContent>
          </Popover>
          <span className="ml-auto text-[10px] text-zinc-500">
            {validation.durationMs}ms validation
          </span>
        </div>

        <CheckGrid validation={validation} />

        <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
              Mutation
            </span>
            <span className="ml-auto font-mono text-[10px] text-zinc-300">
              {mutationSummary(validation.mutation)}
            </span>
          </div>
          {validation.mutation?.status === "measured" && (
            <p className="mt-1 truncate font-mono text-[9px] text-zinc-500">
              {validation.mutation.command}
            </p>
          )}
        </div>

        <div className="grid gap-2 lg:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <FileCode2 className="size-3.5 shrink-0 text-sky-400" />
              <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
                Source
              </p>
              <span className="truncate font-mono text-[9px] text-zinc-600">
                {generation.sourcePath}
              </span>
            </div>
            {generation.source ? (
              <HighlightedCode
                code={generation.source}
                language={languageForPath(generation.sourcePath)}
                className="h-[42vh] max-h-[42vh]"
              />
            ) : (
              <p className="flex h-[42vh] items-center justify-center rounded-xl border border-zinc-800/70 bg-zinc-950/40 px-3 text-center text-[10px] text-zinc-500">
                The source was not included. Open the spec for a contract test.
              </p>
            )}
          </div>
          <div className="min-w-0 space-y-1.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <FileDiff className="size-3.5 shrink-0 text-violet-400" />
              <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
                Generated test
              </p>
              <span className="truncate font-mono text-[9px] text-zinc-600">
                {generation.testPath}
              </span>
              <Hint label="Download test">
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto size-6"
                  aria-label="Download test"
                  onClick={() =>
                    downloadFile(
                      generation.testPath.split("/").pop() ?? "test.ts",
                      generation.code,
                      "text/typescript",
                    )
                  }
                >
                  <HardDriveDownload className="size-3.5" stroke={ICON_GRADIENT} />
                </Button>
              </Hint>
            </div>
            <HighlightedCode
              code={generation.code}
              language={languageForPath(generation.testPath)}
              className="h-[42vh] max-h-[42vh]"
            />
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export function EndpointDialog({
  open,
  onClose,
  spec,
  endpoint,
  result,
  contractTest,
  onOpenSpec,
  onOpenContract,
}: {
  open: boolean;
  onClose: () => void;
  spec?: OpenApiSpec;
  endpoint?: OpenApiEndpoint;
  result?: ApiTestResult;
  contractTest?: AgentTest;
  onOpenSpec: () => void;
  onOpenContract: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [endpoint?.method, endpoint?.path]);
  if (!endpoint) return null;
  const method = endpoint.method.toUpperCase();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${method} ${endpoint.path}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard is blocked; the operation stays visible.
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${method} ${endpoint.path}`}
      description={`${endpoint.operationId ?? "operation"} · ${spec?.path ?? "spec"}`}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" size="sm" className="mr-auto" onClick={onOpenSpec}>
            <FileJson className="size-3.5" stroke={ICON_GRADIENT} />
            Open spec
          </Button>
          {contractTest && (
            <Button variant="outline" size="sm" onClick={onOpenContract}>
              <FileCode2 className="size-3.5 text-violet-400" />
              Contract test
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? (
              <Check className="size-3.5 text-emerald-400" />
            ) : (
              <Clipboard className="size-3.5 text-sky-300" />
            )}
            {copied ? "Copied" : "Copy operation"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <MethodChip method={method} />
          <EndpointStatus result={result} />
          {result?.durationMs !== undefined && (
            <Badge variant="neutral" className="gap-1">
              <Timer className="size-3 text-sky-400" />
              {result.durationMs}ms
            </Badge>
          )}
          {endpoint.operationId && (
            <Badge variant="neutral" className="font-mono">
              {endpoint.operationId}
            </Badge>
          )}
          {endpoint.security?.length ? (
            <Badge variant="warning">auth · {endpoint.security.join(", ")}</Badge>
          ) : null}
        </div>

        {result?.error && (
          <Alert variant="danger">
            <TriangleAlert />
            <div>
              <AlertTitle>
                Contract test failed{result.diagnosis ? ` · ${result.diagnosis}` : ""}
              </AlertTitle>
              <AlertDescription>{result.error}</AlertDescription>
            </div>
          </Alert>
        )}

        {(result?.expected || result?.actual) && (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-2">
              <p className="text-[10px] text-zinc-500">Expected</p>
              <p className="mt-0.5 font-mono text-[10px] break-words text-emerald-300">
                {result.expected ?? "not reported"}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-2">
              <p className="text-[10px] text-zinc-500">Actual</p>
              <p className="mt-0.5 font-mono text-[10px] break-words text-rose-300">
                {result.actual ?? "not reported"}
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <Fact label="Documented responses" value={endpoint.responses?.join(", ") ?? "—"} />
          <Fact label="Request body" value={endpoint.requestBody?.contentType ?? "—"} />
          <Fact
            label="Parameters"
            value={endpoint.parameters?.map((p) => `${p.name} (${p.in})`).join(", ") ?? "—"}
          />
          <Fact label="Summary" value={endpoint.summary ?? endpoint.description ?? "—"} />
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
            Spec section
          </p>
          {spec?.content ? (
            <HighlightedCode code={specSection(spec.content, endpoint.path)} language="yaml" />
          ) : (
            <p className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 px-3 py-2 text-[11px] text-zinc-500">
              The raw spec is not available in this scan.
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}

export function SpecDialog({
  open,
  onClose,
  specs,
  focus,
  contractTests,
  onOpenContract,
}: {
  open: boolean;
  onClose: () => void;
  specs: OpenApiSpec[];
  focus?: { specPath: string; method: string; path: string };
  contractTests: AgentTest[];
  onOpenContract: (testPath: string) => void;
}) {
  const [selected, setSelected] = useState(focus?.specPath ?? specs[0]?.path ?? "");
  const [tab, setTab] = useState(focus ? "operation" : "spec");
  const specKey = specs.map((spec) => spec.path).join("|");
  useEffect(() => {
    if (!open) return;
    setSelected(focus?.specPath ?? specs[0]?.path ?? "");
    setTab(focus ? "operation" : "spec");
  }, [open, focus?.specPath, focus?.method, focus?.path, specKey]);
  const spec = specs.find((item) => item.path === selected) ?? specs[0];
  const contract = spec
    ? contractTests.find((item) => item.generation.sourcePath === spec.path)
    : undefined;
  const endpoint = focus
    ? spec?.endpoints.find(
        (item) =>
          item.method.toUpperCase() === focus.method.toUpperCase() && item.path === focus.path,
      )
    : undefined;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={spec?.path ?? "OpenAPI spec"}
      description={
        spec
          ? `${spec.endpoints.length} operations${spec.servers?.length ? ` · ${spec.servers[0]}` : ""}${spec.inferred ? " · inferred from source; review before use" : ""}`
          : "No OpenAPI document was found in this scan."
      }
      className="max-w-3xl"
      actions={
        spec ? (
          <Hint label={tab === "contract" ? "Download contract test" : "Download spec"}>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={tab === "contract" ? "Download contract test" : "Download spec"}
              onClick={() =>
                downloadFile(
                  tab === "contract"
                    ? (contract?.generation.testPath.split("/").pop() ?? "contract.test.ts")
                    : (spec.path.split("/").pop() ?? "openapi.yaml"),
                  tab === "contract" ? (contract?.generation.code ?? "") : (spec.content ?? ""),
                )
              }
            >
              <HardDriveDownload className="size-4" stroke={ICON_GRADIENT} />
            </Button>
          </Hint>
        ) : null
      }
    >
      {!spec ? (
        <p className="py-6 text-center text-[11px] text-zinc-500">
          Scan a repository with an OpenAPI document to see it here.
        </p>
      ) : (
        <>
          <div className="mb-2.5 flex items-start gap-2.5 rounded-xl border border-indigo-500/25 bg-indigo-500/[0.06] px-3 py-2">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-indigo-300" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-zinc-200">
                {spec.inferred
                  ? "Inferred from source — review before use"
                  : "Built from the spec — no model call"}
              </p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">
                {spec.inferred
                  ? "No OpenAPI document was found, so EdgeSpec read route calls and marked the result inferred. Confirm each operation before treating it as a contract."
                  : "EdgeSpec reads the document and writes the contract test itself. Only test files are added; your application code is never modified."}
              </p>
            </div>
          </div>
          {specs.length > 1 && (
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide text-zinc-500">Spec</span>
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger className="h-8 w-64 font-mono text-[10px]" aria-label="OpenAPI spec">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {specs.map((item) => (
                    <SelectItem key={item.path} value={item.path}>
                      {item.path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as "operation" | "spec" | "contract")}
            className="space-y-2"
          >
            <TabsList>
              {focus && endpoint && (
                <TabsTrigger value="operation">
                  <MethodChip method={focus.method} />
                  Operation
                </TabsTrigger>
              )}
              <TabsTrigger value="spec">
                <FileJson className="size-3.5" />
                Full spec
              </TabsTrigger>
              <TabsTrigger value="contract">
                <FileCode2 className="size-3.5 text-violet-400" />
                Contract test
              </TabsTrigger>
            </TabsList>
            {focus && endpoint && (
              <TabsContent value="operation">
                <HighlightedCode
                  code={
                    spec.content
                      ? specSection(spec.content, endpoint.path)
                      : "Raw spec unavailable."
                  }
                  language="yaml"
                />
                <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
                  Only this path from {spec.path}. The full document and the generated contract are
                  one tab away.
                </p>
              </TabsContent>
            )}
            <TabsContent value="spec">
              {spec.content ? (
                <HighlightedCode code={spec.content} language="yaml" />
              ) : (
                <p className="text-[11px] text-zinc-500">Raw spec content is not available.</p>
              )}
            </TabsContent>
            <TabsContent value="contract">
              {contract ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="neutral" className="font-mono">
                      {contract.generation.testPath}
                    </Badge>
                    <CheckSummary validation={contract.validation} />
                    <Button
                      variant="outline"
                      size="xs"
                      className="ml-auto"
                      onClick={() => onOpenContract(contract.generation.sourcePath)}
                    >
                      <FileCode2 className="size-3.5" />
                      Open in review
                    </Button>
                  </div>
                  <HighlightedCode code={contract.generation.code} language="typescript" />
                </div>
              ) : (
                <div className="space-y-2 py-4 text-center">
                  <p className="text-[11px] text-zinc-500">
                    No contract test was generated in this run.
                  </p>
                  <p className="text-[10px] text-zinc-600">
                    Start a run; EdgeSpec builds one test file per spec when the pipeline reaches
                    the contract stage.
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </Dialog>
  );
}

export function FactsDialog({
  open,
  onClose,
  overview,
  specs,
  coverageStatus,
  coverageReason,
}: {
  open: boolean;
  onClose: () => void;
  overview?: RepositoryOverview;
  specs: OpenApiSpec[];
  coverageStatus?: "not-run" | "unavailable" | "measured";
  coverageReason?: string;
}) {
  const total = overview?.languages.reduce((sum, language) => sum + language.count, 0) ?? 0;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Repository facts"
      description={
        overview
          ? `${overview.totalFiles.toLocaleString()} files · ${overview.sourceFiles} source · ${overview.testFiles} tests`
          : "Scan the repository to read its tooling and CI checks."
      }
      className="max-w-2xl"
    >
      {!overview ? (
        <p className="py-6 text-center text-[11px] text-zinc-500">No scan yet.</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Source files", value: overview.sourceFiles, icon: FileCode2 },
              { label: "Test files", value: overview.testFiles, icon: FlaskConical },
              {
                label: "Runtime",
                value: `${overview.runtime ?? "unknown"}${overview.runtimeVersion ? ` ${overview.runtimeVersion}` : ""}`,
                icon: Cpu,
              },
              {
                label: "Package manager",
                value: overview.packageManager ?? "unknown",
                icon: Package,
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="rounded-xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/[0.06] to-violet-500/[0.06] p-2.5"
                >
                  <div className="flex items-center gap-1.5">
                    <Icon className="size-3.5 shrink-0" stroke={ICON_GRADIENT} />
                    <p className="text-[10px] text-zinc-500">{item.label}</p>
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-zinc-200">{item.value}</p>
                </div>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
              Languages
            </p>
            {overview.languages.length === 0 ? (
              <p className="text-[11px] text-zinc-500">No source languages found.</p>
            ) : (
              overview.languages.map((language) => {
                const meta = LANGUAGE_META[language.name] ?? {
                  icon: FileCode2,
                  tone: "text-zinc-400",
                  bar: "bg-zinc-500",
                };
                const Icon = meta.icon;
                return (
                  <div key={language.name} className="flex items-center gap-2">
                    <span className="flex w-28 shrink-0 items-center gap-1.5">
                      <Icon className={cn("size-3.5 shrink-0", meta.tone)} />
                      <span className="text-[11px] text-zinc-300">{language.name}</span>
                    </span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                      <span
                        className={cn("block h-full rounded-full", meta.bar)}
                        style={{ width: `${total ? (language.count / total) * 100 : 0}%` }}
                      />
                    </span>
                    <span className="w-8 text-right font-mono text-[10px] text-zinc-500">
                      {language.count}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {overview.frameworks.map((framework) => (
              <Badge key={framework} variant="neutral">
                {framework}
              </Badge>
            ))}
            {overview.formatter && (
              <Badge variant="neutral">formatter · {overview.formatter}</Badge>
            )}
            {overview.testRunner && <Badge variant="neutral">runner · {overview.testRunner}</Badge>}
            <Badge variant={coverageStatus === "measured" ? "success" : "warning"}>
              Coverage · {coverageLabel(coverageStatus)}
              {coverageReason ? ` · ${coverageReason}` : ""}
            </Badge>
            <Badge variant="neutral">
              {specs.length} OpenAPI document{specs.length === 1 ? "" : "s"}
            </Badge>
          </div>

          <Separator />

          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
              CI checks <span className="text-zinc-600">· declared, not executed by this scan</span>
            </p>
            {(overview.checks ?? []).length === 0 ? (
              <p className="text-[11px] text-zinc-500">No CI checks declared in the repository.</p>
            ) : (
              (overview.checks ?? []).map((check) => (
                <div
                  key={check.command}
                  className="flex items-center gap-2 rounded-lg border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-1.5"
                >
                  <span
                    className={cn(
                      "w-20 shrink-0 font-mono text-[10px]",
                      CI_TONE[check.kind] ?? "text-indigo-300",
                    )}
                  >
                    {check.kind}
                  </span>
                  <span className="truncate font-mono text-[10px] text-zinc-300">
                    {check.command}
                  </span>
                </div>
              ))
            )}
          </div>

          {specs.length > 0 && (
            <Alert variant="info">
              <FileJson />
              <div>
                <AlertTitle>
                  {specs.length} OpenAPI document{specs.length === 1 ? "" : "s"}
                </AlertTitle>
                <AlertDescription>{specs.map((spec) => spec.path).join(" · ")}</AlertDescription>
              </div>
            </Alert>
          )}
        </div>
      )}
    </Dialog>
  );
}

export function PrDialog({
  open,
  onClose,
  entries,
  skipped,
  settings,
  project,
  value,
  onChange,
  onDispatch,
  busy,
  error,
}: {
  open: boolean;
  onClose: () => void;
  entries: ReviewEntry[];
  skipped: ApiTestResult[];
  settings: Settings;
  project: Project;
  value: PrDraft;
  onChange: (next: PrDraft) => void;
  onDispatch: () => void;
  busy: boolean;
  error?: string;
}) {
  const accepted = entries.filter((entry) => entry.state === "accepted");
  const rejected = entries.filter((entry) => entry.state === "rejected");
  const pending = entries.filter((entry) => entry.state === "pending");
  const verified = accepted.filter((entry) => entry.item.validation.verified).length;
  const staticOnly = accepted.filter(
    (entry) => entry.item.validation.ok && !entry.item.validation.verified,
  ).length;
  const blocked = accepted.length === 0 || pending.length > 0 || busy;
  const providerName = providerById(settings.provider)?.name ?? settings.provider;
  const files = accepted.map((entry) => entry.item.generation.testPath);

  const generateCopy = () => {
    onChange({
      ...value,
      title: `test: cover ${files.length || "the"} untested path${files.length === 1 ? "" : "s"}`,
      commit: `test: add ${files.length} generated test file${files.length === 1 ? "" : "s"}`,
      description: pullRequestBody({
        provider: providerName,
        model: settings.model,
        files: provenanceFiles(accepted.map((entry) => entry.item)),
        skipped: skippedOperationsOf(skipped),
        testOnly: true,
      }),
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create pull request"
      description="Review the title, branch and files before opening it."
      className="max-w-3xl"
      footer={
        <>
          <Button variant="ghost" size="sm" className="mr-auto" onClick={onClose}>
            Back to review
          </Button>
          <Hint
            label={
              accepted.length === 0
                ? "Accept at least one test"
                : pending.length > 0
                  ? `Decide on ${pending.length} pending file(s) first`
                  : "Open one pull request with the accepted tests"
            }
          >
            <span className="inline-flex">
              <Button onClick={onDispatch} disabled={blocked}>
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <GitPullRequest className="size-3.5" />
                )}
                Open {value.draft ? "draft " : ""}pull request · {accepted.length} file
                {accepted.length === 1 ? "" : "s"}
              </Button>
            </span>
          </Hint>
        </>
      }
    >
      <div className="space-y-2.5">
        {error && (
          <Alert variant="danger">
            <TriangleAlert />
            <div>
              <AlertTitle>The pull request did not open</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </div>
          </Alert>
        )}
        {pending.length > 0 ? (
          <Alert variant="warning">
            <TriangleAlert />
            <div>
              <AlertTitle>{pending.length} file(s) still pending</AlertTitle>
              <AlertDescription>
                Accept or reject them before opening the pull request, so nothing is dropped
                silently.
              </AlertDescription>
            </div>
          </Alert>
        ) : (
          <Alert variant="success">
            <CheckCircle2 />
            <div>
              <AlertTitle>Every generated file has a decision</AlertTitle>
              <AlertDescription>
                {accepted.length} accepted, {rejected.length} rejected.
              </AlertDescription>
            </div>
          </Alert>
        )}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Summary
            label="Repository"
            value={`${project.repo}${project.ref ? `@${project.ref}` : ""}`}
            icon={FolderGit2}
            iconClass="text-sky-400"
          />
          <Summary
            label="Base branch"
            value={project.ref || "default"}
            icon={GitPullRequest}
            iconClass="text-violet-400"
          />
          <Summary
            label="Model"
            value={`${providerName} · ${settings.model}`}
            icon={Sparkles}
            iconClass="text-fuchsia-400"
          />
          <Summary
            label="Verification"
            value={`${verified} executed · ${staticOnly} static`}
            icon={ShieldCheck}
            iconClass="text-emerald-400"
          />
        </div>

        <div className="space-y-2 rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
              Pull request
            </p>
            <Button variant="outline" size="xs" onClick={generateCopy}>
              <Sparkles className="size-3.5 text-fuchsia-400" />
              Generate title & description
            </Button>
          </div>
          <PField label="Title">
            <Input
              value={value.title}
              onChange={(event) => onChange({ ...value, title: event.target.value })}
              placeholder="test: cover the auth edge runtime"
            />
          </PField>
          <div className="grid gap-2 sm:grid-cols-2">
            <PField label="Branch name">
              <Input
                value={value.branch}
                onChange={(event) => onChange({ ...value, branch: event.target.value })}
                className="font-mono"
              />
            </PField>
            <PField label="Commit message">
              <Input
                value={value.commit}
                onChange={(event) => onChange({ ...value, commit: event.target.value })}
              />
            </PField>
          </div>
          <PField label="Description">
            <Textarea
              rows={4}
              value={value.description}
              onChange={(event) => onChange({ ...value, description: event.target.value })}
              className="font-mono text-[10px]"
            />
          </PField>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-2.5 py-1.5">
            <span>
              <span className="block text-[11px] font-medium text-zinc-300">
                Open as a draft pull request
              </span>
              <span className="block text-[10px] text-zinc-500">
                Reviewers can comment before it is ready.
              </span>
            </span>
            <Switch
              checked={value.draft}
              onCheckedChange={(draft) => onChange({ ...value, draft })}
              size="sm"
              aria-label="Open as a draft pull request"
            />
          </label>
        </div>

        <Section title={`Included (${accepted.length})`} tone="success">
          {accepted.length === 0 ? (
            <p className="text-[11px] text-zinc-500">Nothing accepted yet.</p>
          ) : (
            accepted.map((entry) => (
              <div
                key={entry.item.generation.testPath}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] px-2.5 py-1.5"
              >
                <FileCode2 className="size-3.5 shrink-0 text-emerald-400" />
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-200">
                  {entry.item.generation.testPath}
                </span>
                <CheckSummary validation={entry.item.validation} />
              </div>
            ))
          )}
        </Section>

        <Section title={`Excluded (${rejected.length + skipped.length})`} tone="warning">
          {rejected.map((entry) => (
            <div
              key={entry.item.generation.testPath}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/[0.04] px-2.5 py-1.5"
            >
              <X className="size-3.5 shrink-0 text-rose-400" />
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-200">
                {entry.item.generation.testPath}
              </span>
              <span className="text-[10px] text-zinc-500">rejected by you</span>
            </div>
          ))}
          {skipped.map((row) => (
            <div
              key={`${row.specPath}-${row.method}-${row.path}`}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-2.5 py-1.5"
            >
              <TriangleAlert className="size-3.5 shrink-0 text-amber-400" />
              <MethodChip method={row.method} />
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-200">
                {row.path}
              </span>
              <span className="text-[10px] text-zinc-500">
                skipped{row.error ? ` · ${row.error}` : ""}
              </span>
            </div>
          ))}
          {rejected.length + skipped.length === 0 && (
            <p className="text-[11px] text-zinc-500">Nothing excluded.</p>
          )}
        </Section>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-1.5 text-[10px] text-zinc-500">
          <Wrench className="size-3.5 shrink-0 text-stage-fix" />
          <span className="font-semibold text-zinc-300">One commit</span>
          <span>{accepted.length} test files</span>
          <span>· {verified} executed</span>
          <span>· {staticOnly} static</span>
          <span>· no app source changes</span>
        </div>
      </div>
    </Dialog>
  );
}

function LogLines({ lines }: { lines: LogEntry[] }) {
  if (lines.length === 0) {
    return (
      <p className="py-6 text-center text-[11px] text-zinc-600">No events match this filter.</p>
    );
  }
  return (
    <div className="space-y-1 font-mono text-[11px] leading-relaxed">
      {lines.map((line) => (
        <p key={line.id} className="flex gap-2">
          <span className="shrink-0 text-zinc-600">{line.time}</span>
          <span className="w-16 shrink-0 truncate text-[9px] tracking-wide text-zinc-600 uppercase">
            {line.step ? STEP_LABEL[line.step] : "run"}
          </span>
          <span className={cn("min-w-0 break-words", LEVEL_CLASS[line.level])}>{line.text}</span>
        </p>
      ))}
    </div>
  );
}

const LEVEL_CLASS: Record<LogLevel, string> = {
  info: "text-zinc-400",
  ai: "text-violet-300",
  warn: "text-amber-400",
  success: "text-emerald-400",
  error: "text-rose-400",
};

function CheckGrid({ validation }: { validation: import("@edge-spec/core/types").Validation }) {
  const checks = validation.checks ?? [];
  if (checks.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Tile
          label={validation.verified ? "Executed" : "Static only"}
          detail={`${validation.durationMs}ms`}
          status={validation.ok ? (validation.verified ? "passed" : "warning") : "failed"}
          icon={ShieldCheck}
        />
        <Tile
          label={validation.ok ? "Suite passed" : "Suite failed"}
          detail={`${failedChecks(validation)} failed · ${skippedChecks(validation)} skipped`}
          status={validation.ok ? "passed" : "failed"}
          icon={FlaskConical}
        />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {checks.map((check) => (
        <Tile
          key={`${check.kind}-${check.name}`}
          label={check.name || check.kind}
          detail={`${check.durationMs}ms${check.skipped ? " · skipped" : ""}`}
          status={check.skipped ? "warning" : check.ok ? "passed" : "failed"}
          icon={CHECK_ICON[check.kind] ?? ListChecks}
          title={check.command}
        />
      ))}
    </div>
  );
}

const CHECK_ICON: Record<string, typeof AlignLeft> = {
  format: AlignLeft,
  lint: ListChecks,
  typecheck: Type,
  build: Package,
  test: FlaskConical,
};

function Tile({
  label,
  detail,
  status,
  icon: Icon,
  title,
}: {
  label: string;
  detail: string;
  status: "passed" | "failed" | "warning";
  icon: typeof AlignLeft;
  title?: string;
}) {
  const StatusIcon = status === "passed" ? CheckCircle2 : TriangleAlert;
  return (
    <div
      title={title}
      className="flex items-center gap-2 rounded-lg border border-indigo-500/20 bg-gradient-to-br from-indigo-500/[0.06] to-violet-500/[0.06] px-2.5 py-1.5"
    >
      <Icon className="size-3.5 shrink-0 text-zinc-500" />
      <span className="min-w-0">
        <span className="block truncate text-[10px] text-zinc-300">{label}</span>
        <span className="block truncate font-mono text-[9px] text-zinc-500">{detail}</span>
      </span>
      <StatusIcon
        className={cn(
          "ml-auto size-3.5 shrink-0",
          status === "passed"
            ? "text-emerald-400"
            : status === "warning"
              ? "text-amber-400"
              : "text-rose-400",
        )}
      />
    </div>
  );
}

function CodeBlock({ lines, kind = "plain" }: { lines: string[]; kind?: "plain" | "add" }) {
  return (
    <div className="no-scrollbar max-h-[46vh] overflow-auto rounded-xl border border-zinc-800/70 bg-zinc-950/70 py-1 font-mono text-[11px] leading-5">
      {lines.map((line, index) => {
        const blank = line.trim() === "";
        return (
          <div
            key={index}
            className={cn("flex gap-3 px-3", kind === "add" && !blank && "bg-emerald-500/[0.06]")}
          >
            <span className="w-6 shrink-0 text-right text-[10px] text-zinc-500 select-none">
              {index + 1}
            </span>
            {kind === "add" && (
              <span className={cn("w-2 shrink-0", blank ? "text-zinc-600" : "text-emerald-400")}>
                {blank ? "" : "+"}
              </span>
            )}
            <span className="min-w-0 whitespace-pre-wrap break-words text-zinc-300">
              {line || " "}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function languageForPath(path: string): "json" | "typescript" | "yaml" {
  if (/\.ya?ml$/i.test(path)) return "yaml";
  if (/\.json$/i.test(path)) return "json";
  return "typescript";
}

function specSection(spec: string, path: string): string {
  const lines = spec.split("\n");
  const start = lines.findIndex((line) => line.trim() === `${path}:`);
  if (start === -1) return spec;
  const end = lines.findIndex((line, index) => index > start && /^ {2}\/[\w./{}]+:$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

const LANGUAGE_META: Record<string, { icon: typeof FileCode2; tone: string; bar: string }> = {
  TypeScript: { icon: FileCode2, tone: "text-indigo-300", bar: "bg-indigo-400" },
  JavaScript: { icon: FileJson, tone: "text-amber-300", bar: "bg-amber-400" },
  CSS: { icon: Palette, tone: "text-sky-300", bar: "bg-sky-400" },
};

const CI_TONE: Record<string, string> = {
  format: "text-sky-300",
  lint: "text-violet-300",
  typecheck: "text-amber-300",
  test: "text-emerald-300",
  build: "text-indigo-300",
};

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-2">
      <p className="text-[10px] text-zinc-500">{label}</p>
      <p className="mt-0.5 line-clamp-2 font-mono text-[10px] text-zinc-300">{value}</p>
    </div>
  );
}

function Summary({
  label,
  value,
  icon: Icon,
  iconClass,
}: {
  label: string;
  value: string;
  icon: typeof FolderGit2;
  iconClass?: string;
}) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-2">
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", iconClass ?? "text-zinc-500")} />
      <div className="min-w-0">
        <p className="text-[10px] text-zinc-500">{label}</p>
        <p className="truncate font-mono text-[10px] text-zinc-200">{value}</p>
      </div>
    </div>
  );
}

function PField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "success" | "warning";
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p
        className={cn(
          "text-[10px] font-semibold tracking-wide uppercase",
          tone === "success" ? "text-emerald-400" : "text-amber-400",
        )}
      >
        {title}
      </p>
      {children}
    </div>
  );
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Stored runs for one repository, with a two-run compare. */
type RunTone = {
  badge: "success" | "danger" | "accent" | "neutral";
  bar: string;
  tint: string;
  dot: string;
};

const RUN_TONE: Record<string, RunTone> = {
  ready: {
    badge: "success",
    bar: "border-l-emerald-400/70",
    tint: "bg-emerald-500/[0.04]",
    dot: "bg-emerald-400",
  },
  failed: {
    badge: "danger",
    bar: "border-l-rose-400/70",
    tint: "bg-rose-500/[0.05]",
    dot: "bg-rose-400",
  },
  running: {
    badge: "accent",
    bar: "border-l-sky-400/70",
    tint: "bg-sky-500/[0.04]",
    dot: "bg-sky-400",
  },
};

const runTone = (status: string): RunTone =>
  RUN_TONE[status] ?? {
    badge: "neutral",
    bar: "border-l-zinc-500/70",
    tint: "bg-zinc-900/40",
    dot: "bg-zinc-500",
  };

export function HistoryDialog({
  open,
  onClose,
  repo,
}: {
  open: boolean;
  onClose: () => void;
  repo: string;
}) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string[]>([]);
  const [comparison, setComparison] = useState<RunComparison>();
  const [deleting, setDeleting] = useState(false);
  const [artifactBusy, setArtifactBusy] = useState<string>();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!open || !repo) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetchRuns(repo)
      .then((result) => {
        if (cancelled) return;
        setEnabled(result.enabled);
        setRuns(result.runs);
        setSelected([]);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, repo, reload]);

  useEffect(() => {
    if (selected.length !== 2) {
      setComparison(undefined);
      return;
    }
    let cancelled = false;
    Promise.all(selected.map((id) => fetchRunDetail(id)))
      .then(([before, after]) => {
        if (cancelled || !before || !after || !before.enabled || !after.enabled) return;
        setComparison(compareRuns(before, after));
      })
      .catch(() => {
        if (!cancelled) setComparison(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(-2),
    );
  };

  const remove = async () => {
    if (!repo || !window.confirm(`Delete all run history for ${repo}?`)) return;
    setDeleting(true);
    try {
      await deleteRuns(repo);
      setReload((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDeleting(false);
    }
  };

  /** The bundle is written for interactive runs only; a 404 is a normal miss. */
  const downloadArtifact = async (run: RunSummary) => {
    setArtifactBusy(run.id);
    setError(undefined);
    try {
      const result = await fetchRunArtifacts(run.id);
      if (!result.enabled) {
        setError("Run artifacts are not enabled: this deployment has no R2 ARTIFACTS binding.");
        return;
      }
      if (!result.artifact) {
        setError(`No artifact bundle was stored for this run (${when(run.startedAt)}).`);
        return;
      }
      downloadFile(
        `edge-spec-${run.id}.json`,
        JSON.stringify(result.artifact, null, 2),
        "application/json",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setArtifactBusy(undefined);
    }
  };

  const readyCount = runs.filter((run) => run.status === "ready").length;
  const failedCount = runs.filter((run) => run.status === "failed").length;
  const runningCount = runs.filter((run) => run.status === "running").length;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Run history"
      description={`${repo} · select two runs to compare`}
      className="max-w-4xl"
      footer={
        <Button
          variant="ghost"
          size="sm"
          className="mr-auto"
          onClick={remove}
          disabled={!enabled || deleting || runs.length === 0}
        >
          {deleting ? <Loader2 className="animate-spin" /> : <Trash2 className="size-3.5" />}
          Delete history
        </Button>
      }
    >
      {!enabled ? (
        <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/20 px-3 py-8 text-center text-[11px] text-zinc-500">
          Run history is not enabled on this deployment. Add the optional D1 binding in
          wrangler.toml and apply migrations/0001_runs.sql.
        </p>
      ) : loading ? (
        <p className="flex items-center justify-center gap-2 py-8 text-[11px] text-zinc-500">
          <Loader2 className="size-3.5 animate-spin" /> Loading runs…
        </p>
      ) : runs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/20 px-3 py-8 text-center text-[11px] text-zinc-500">
          No stored runs yet. Complete a run to record one.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-500/20 bg-gradient-to-r from-sky-500/10 via-indigo-500/10 to-emerald-500/10 px-3 py-2">
            <span className="text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
              Runs
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-zinc-300">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              {readyCount} ready
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-zinc-300">
              <span className="size-1.5 rounded-full bg-rose-400" />
              {failedCount} failed
            </span>
            {runningCount > 0 && (
              <span className="flex items-center gap-1.5 text-[10px] text-zinc-300">
                <span className="size-1.5 rounded-full bg-sky-400" />
                {runningCount} running
              </span>
            )}
            <span className="ml-auto text-[10px] text-zinc-500">{runs.length} total</span>
          </div>
          <div className="no-scrollbar max-h-[34vh] space-y-1.5 overflow-auto">
            {runs.map((run) => {
              const index = selected.indexOf(run.id);
              const tone = runTone(run.status);
              return (
                <div key={run.id} className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => toggle(run.id)}
                    className={cn(
                      "min-w-0 flex-1 rounded-xl border-y border-r border-l-2 px-3 py-2 text-left transition",
                      tone.bar,
                      index >= 0
                        ? "border-indigo-500/40 bg-indigo-500/10"
                        : cn(tone.tint, "border-zinc-800/70 hover:border-zinc-700"),
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={tone.badge}>{run.status}</Badge>
                      {index >= 0 && (
                        <Badge variant="accent">{index === 0 ? "before" : "after"}</Badge>
                      )}
                      <span className="text-[11px] text-zinc-300">{when(run.startedAt)}</span>
                      <span className="ml-auto font-mono text-[10px] text-zinc-500">
                        {run.provider} · {run.model}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-500">
                      <span>{run.totals.missing} missing</span>
                      <span>{run.totals.coverage} coverage</span>
                      <span>{run.totals.api} api</span>
                      <span>{run.totals.skipped} skipped by policy</span>
                    </div>
                  </button>
                  <Hint label="Download the stored artifact bundle">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Download artifacts for the run at ${when(run.startedAt)}`}
                      onClick={() => downloadArtifact(run)}
                      disabled={artifactBusy === run.id}
                    >
                      {artifactBusy === run.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <HardDriveDownload className="size-3.5 text-zinc-400" />
                      )}
                    </Button>
                  </Hint>
                </div>
              );
            })}
          </div>
          {comparison ? (
            <ComparePanel comparison={comparison} />
          ) : (
            <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/20 px-3 py-4 text-center text-[11px] text-zinc-500">
              Select two runs to compare files, verification, decisions and coverage.
            </p>
          )}
        </div>
      )}
      {error && <p className="mt-3 text-[11px] text-rose-300">{error}</p>}
    </Dialog>
  );
}

const BACKLOG_TONE: Record<
  BacklogState,
  {
    label: string;
    badge: "accent" | "success" | "danger" | "neutral";
    tint: string;
    dot: string;
  }
> = {
  open: {
    label: "Open",
    badge: "accent",
    tint: "bg-sky-500/[0.04]",
    dot: "bg-sky-400",
  },
  accepted: {
    label: "Accepted",
    badge: "success",
    tint: "bg-emerald-500/[0.05]",
    dot: "bg-emerald-400",
  },
  rejected: {
    label: "Rejected",
    badge: "danger",
    tint: "bg-rose-500/[0.05]",
    dot: "bg-rose-400",
  },
  ignored: {
    label: "Ignored",
    badge: "neutral",
    tint: "bg-zinc-900/40",
    dot: "bg-zinc-500",
  },
  closed: {
    label: "Closed",
    badge: "neutral",
    tint: "bg-violet-500/[0.04]",
    dot: "bg-violet-400",
  },
};

/** Durable test-debt items for one repository. */
export function BacklogDialog({
  open,
  onClose,
  repo,
}: {
  open: boolean;
  onClose: () => void;
  repo: string;
}) {
  const [items, setItems] = useState<BacklogItem[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<"all" | BacklogState>("open");
  const [busy, setBusy] = useState<string>();

  useEffect(() => {
    if (!open || !repo) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetchBacklog(repo)
      .then((result) => {
        if (cancelled) return;
        setEnabled(result.enabled);
        setItems(result.items);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, repo]);

  const act = async (item: BacklogItem, state: BacklogState) => {
    setBusy(item.path);
    try {
      await updateBacklog(repo, item.path, state);
      setItems((current) =>
        current.map((entry) => (entry.path === item.path ? { ...entry, state } : entry)),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const visible = filter === "all" ? items : items.filter((item) => item.state === filter);
  const counts: Record<BacklogState, number> = {
    open: 0,
    accepted: 0,
    rejected: 0,
    ignored: 0,
    closed: 0,
  };
  for (const item of items) counts[item.state] += 1;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Test-debt backlog"
      description={`${repo} · scans keep this current`}
      className="max-w-4xl"
    >
      {!enabled ? (
        <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/20 px-3 py-8 text-center text-[11px] text-zinc-500">
          The backlog needs the optional D1 binding (`RUNS_DB`).
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] transition",
                filter === "all"
                  ? "border-indigo-400/60 bg-indigo-500/15 text-indigo-200"
                  : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200",
              )}
            >
              All <span className="font-mono text-zinc-500">{items.length}</span>
            </button>
            {(Object.keys(BACKLOG_TONE) as BacklogState[]).map((state) => {
              const tone = BACKLOG_TONE[state];
              return (
                <button
                  key={state}
                  type="button"
                  onClick={() => setFilter(state)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] transition",
                    filter === state
                      ? "border-indigo-400/60 bg-indigo-500/15 text-indigo-200"
                      : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200",
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", tone.dot)} />
                  {tone.label}
                  <span className="font-mono text-zinc-500">{counts[state]}</span>
                </button>
              );
            })}
            <span className="ml-auto text-[10px] text-zinc-500">{visible.length} shown</span>
          </div>
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-8 text-[11px] text-zinc-500">
              <Loader2 className="size-3.5 animate-spin" /> Loading backlog…
            </p>
          ) : visible.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/20 px-3 py-8 text-center text-[11px] text-zinc-500">
              No backlog items in this state.
            </p>
          ) : (
            <div className="no-scrollbar max-h-[50vh] space-y-1.5 overflow-auto">
              {visible.map((item) => {
                const tone = BACKLOG_TONE[item.state];
                return (
                  <div
                    key={item.path}
                    className={cn(
                      "flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800/70 px-3 py-2 transition hover:border-zinc-700",
                      tone.tint,
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[11px] text-zinc-200">
                        {item.path}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                        <Badge variant={tone.badge}>{tone.label}</Badge>
                        <Badge variant="neutral">{item.kind}</Badge>
                        {item.risk && (
                          <Badge
                            variant={
                              item.risk === "high"
                                ? "danger"
                                : item.risk === "medium"
                                  ? "warning"
                                  : "neutral"
                            }
                          >
                            {item.risk} risk
                          </Badge>
                        )}
                        <span>{item.owner ?? "unowned"}</span>
                        <span>· last seen {when(item.lastSeen)}</span>
                      </span>
                    </span>
                    <Select
                      value={item.state}
                      onValueChange={(value) => void act(item, value as BacklogState)}
                      disabled={busy === item.path}
                    >
                      <SelectTrigger className="h-8 w-28 text-[11px]" aria-label="Backlog state">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="accepted">Accepted</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                        <SelectItem value="ignored">Ignored</SelectItem>
                        <SelectItem value="closed">Closed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          )}
          {error && <p className="text-[11px] text-rose-300">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}

function ComparePanel({ comparison }: { comparison: RunComparison }) {
  const rows: Array<[string, string, number, 1 | -1]> = [
    [
      "Missing tests",
      `${comparison.missing.before} → ${comparison.missing.after}`,
      comparison.missing.delta,
      -1,
    ],
    [
      "Files covered",
      `${comparison.files.before} → ${comparison.files.after}`,
      comparison.files.after - comparison.files.before,
      1,
    ],
    [
      "Verified",
      `${comparison.verified.before} → ${comparison.verified.after}`,
      comparison.verified.after - comparison.verified.before,
      1,
    ],
    [
      "Accepted",
      `${comparison.accepted.before} → ${comparison.accepted.after}`,
      comparison.accepted.after - comparison.accepted.before,
      1,
    ],
    [
      "Rejected",
      `${comparison.rejected.before} → ${comparison.rejected.after}`,
      comparison.rejected.after - comparison.rejected.before,
      -1,
    ],
    [
      "Coverage lines",
      `${signed(comparison.coverageLines.before)} → ${signed(comparison.coverageLines.after)}`,
      comparison.coverageLines.delta,
      1,
    ],
  ];

  return (
    <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-3">
      <p className="text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
        Compare · {comparison.newFiles.length} new, {comparison.closedFiles.length} closed
      </p>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {rows.map(([label, values, delta, direction]) => {
          const good = delta * direction;
          return (
            <div
              key={label}
              className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800/60 px-2.5 py-1.5"
            >
              <span className="text-[10px] text-zinc-500">{label}</span>
              <span className="font-mono text-[10px] text-zinc-300">{values}</span>
              <Badge variant={good > 0 ? "success" : good < 0 ? "danger" : "neutral"}>
                {signed(delta)}
              </Badge>
            </div>
          );
        })}
      </div>
      {comparison.newFiles.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-[10px] font-semibold text-emerald-400">New files</p>
          {comparison.newFiles.slice(0, 10).map((path) => (
            <p key={path} className="truncate font-mono text-[10px] text-zinc-400">
              {path}
            </p>
          ))}
        </div>
      )}
      {comparison.closedFiles.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-[10px] font-semibold text-zinc-400">No longer covered</p>
          {comparison.closedFiles.slice(0, 10).map((path) => (
            <p key={path} className="truncate font-mono text-[10px] text-zinc-500">
              {path}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
