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
  TriangleAlert,
  Type,
  Wrench,
  X,
} from "lucide-react";
import { providerById } from "@edge-spec/core/catalog";
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
import type { Project, Settings } from "@/lib/settings";
import { HighlightedCode } from "./highlight";
import {
  CheckSummary,
  EndpointStatus,
  coverageLabel,
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
              <AlertTitle>Contract test failed</AlertTitle>
              <AlertDescription>{result.error}</AlertDescription>
            </div>
          </Alert>
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
          ? `${spec.endpoints.length} operations${spec.servers?.length ? ` · ${spec.servers[0]}` : ""}`
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
                Built from the spec — no model call
              </p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">
                EdgeSpec reads the document and writes the contract test itself. Only test files are
                added; your application code is never modified.
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
      description: [
        "## Summary",
        "",
        `Generated with ${providerName} · ${settings.model}.`,
        "",
        ...files.map((file) => `- ${file}`),
        "",
        "## Verification",
        "",
        verified
          ? `- ${verified} suite(s) executed on the runner.`
          : "- No runner executed these tests.",
        staticOnly ? `- ${staticOnly} suite(s) passed static checks only.` : "",
        skipped.length ? `- ${skipped.length} contract operation(s) skipped.` : "",
        "- Application source was not modified.",
      ]
        .filter(Boolean)
        .join("\n"),
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
