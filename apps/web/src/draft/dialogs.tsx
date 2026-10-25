/** Every modal the four-step workspace opens. Fixtures only. */
import { useEffect, useState, type ReactNode } from "react";
import {
  AlignLeft,
  Check,
  CheckCircle2,
  Clipboard,
  Download,
  FileCode2,
  FileDiff,
  FileJson,
  FlaskConical,
  FolderGit2,
  GitPullRequest,
  ListChecks,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Timer,
  TriangleAlert,
  Type,
  Wrench,
  X,
} from "lucide-react";
import { providerById } from "@edge-spec/core/catalog";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Dialog,
  Hint,
  Input,
  Separator,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  cn,
} from "@edge-spec/ui";
import {
  CHECKS,
  DIFFS,
  FACTS,
  LOGS,
  RECENT_PRS,
  SOURCES,
  SPEC_YAML,
  type GeneratedFile,
  type StageId,
} from "./data";
import {
  CheckSummary,
  EndpointStatus,
  LogLines,
  MethodChip,
  STAGE_LABEL,
  downloadFile,
  type EndpointRow,
} from "./shared";
import type { DraftSettings } from "./settings-sheet";
import { HighlightedCode } from "./highlight";

export type ReviewState = "pending" | "accepted" | "rejected";

export interface ReviewEntry {
  file: GeneratedFile;
  state: ReviewState;
}

export interface PrDraft {
  title: string;
  branch: string;
  commit: string;
  description: string;
  draft: boolean;
}

export const DEFAULT_PR_DRAFT: PrDraft = {
  title: "test: cover the auth edge runtime and contract gaps",
  branch: "edgespec/tests-2026-10-25",
  commit: "test: add 2 generated test files",
  description:
    "## Summary\n\n- src/auth/session.test.ts\n- openapi.contract.test.ts\n\n## Verification\n\n- Docker sandbox · format, lint, typecheck, test\n- App source unchanged",
  draft: true,
};

const STAGE_ORDER: StageId[] = ["clone", "analyze", "test", "fix"];

export function LogDialog({
  open,
  onClose,
  stage,
  onStage,
}: {
  open: boolean;
  onClose: () => void;
  stage: StageId | "all";
  onStage: (stage: StageId | "all") => void;
}) {
  const lines = stage === "all" ? LOGS : LOGS.filter((line) => line.stage === stage);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={stage === "all" ? "Pipeline event log" : `${STAGE_LABEL[stage]} events`}
      description={`${lines.length} events · timestamps are relative to the run start.`}
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
                `edgespec-run-${stage}.log`,
                lines
                  .map((line) => `${line.at} [${line.stage}] ${line.level} ${line.text}`)
                  .join("\n"),
              )
            }
          >
            <Download className="size-4" />
          </Button>
        </Hint>
      }
    >
      <Tabs
        value={stage}
        onValueChange={(value) => onStage(value as StageId | "all")}
        className="space-y-3"
      >
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="all">All · {LOGS.length}</TabsTrigger>
          {STAGE_ORDER.map((id) => (
            <TabsTrigger key={id} value={id}>
              {STAGE_LABEL[id]} · {LOGS.filter((line) => line.stage === id).length}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={stage}>
          <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/60 p-3">
            <LogLines lines={lines} />
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
  const diff = DIFFS[entry.file.source] ?? [];
  const added = diff.filter((line) => line.trim() !== "").length;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={entry.file.test}
      description={`New test file generated from ${entry.file.source}`}
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
                entry.file.test.split("/").pop() ?? "test.ts",
                diff.join("\n"),
                "text/typescript",
              )
            }
          >
            <Download className="size-4" />
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
            {entry.file.source} → {entry.file.test}
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
  const sourceCode =
    entry.file.source === "openapi.yaml"
      ? SPEC_YAML
      : (SOURCES[entry.file.source] ?? []).join("\n");
  const state = entry.state;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={entry.file.test}
      description={`Metadata and source for ${entry.file.source}`}
      className="max-w-3xl"
      footer={
        <>
          <Button variant="outline" size="sm" className="mr-auto" onClick={onViewDiff}>
            <FileDiff className="size-3.5" />
            View diff
          </Button>
          <Button variant="outline" size="sm" onClick={onGenerate} disabled={regenerating}>
            <RefreshCw className={cn("size-3.5", regenerating && "animate-spin")} />
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
            disabled={state === "accepted"}
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
            {entry.file.source}
          </Badge>
          <Badge variant="neutral">
            {entry.file.provider} · {entry.file.model}
          </Badge>
          <CheckSummary checks={CHECKS} />
          <span className="ml-auto text-[10px] text-zinc-500">2.4s generation</span>
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">Checks</p>
          <CheckGrid />
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
            {entry.file.source === "openapi.yaml" ? "Spec source" : "Source file"}
          </p>
          <HighlightedCode
            code={sourceCode}
            language={entry.file.source === "openapi.yaml" ? "yaml" : "typescript"}
          />
        </div>
      </div>
    </Dialog>
  );
}

function CheckGrid() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {CHECKS.map((check) => {
        const meta = CHECK_META[check.kind] ?? { icon: FlaskConical, tone: "text-zinc-500" };
        const Icon = meta.icon;
        const status = CHECK_STATUS[check.status];
        const StatusIcon = status.icon;
        return (
          <div
            key={check.kind}
            className="flex items-center gap-2 rounded-lg border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-1.5"
          >
            <Icon className="size-3.5 shrink-0 text-zinc-500" />
            <span className="min-w-0">
              <span className="block truncate text-[10px] text-zinc-300">{check.kind}</span>
              <span className="block truncate font-mono text-[9px] text-zinc-500">
                {check.ms}ms{check.note ? ` · ${check.note}` : ""}
              </span>
            </span>
            <StatusIcon className={cn("ml-auto size-3.5 shrink-0", status.tone)} />
          </div>
        );
      })}
    </div>
  );
}

export function EndpointDialog({
  open,
  onClose,
  row,
  onOpenSpec,
}: {
  open: boolean;
  onClose: () => void;
  row?: EndpointRow;
  onOpenSpec: () => void;
}) {
  const [retest, setRetest] = useState<"idle" | "running" | "done">("idle");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setRetest("idle");
    setCopied(false);
  }, [row?.path]);

  if (!row) return null;
  const logs = [
    ...(row.logs ?? [
      { at: "—", level: "info" as const, text: "No per-endpoint events for this operation." },
    ]),
    ...(retest === "done"
      ? [
          {
            at: "now",
            level: "success" as const,
            text: `re-test passed · ${row.http} · ${row.ms}ms`,
          },
        ]
      : []),
  ];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(row.request ?? `${row.method} ${row.path}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard is blocked; the request is still visible in the panel.
    }
  };

  const startRetest = () => {
    setRetest("running");
    window.setTimeout(() => setRetest("done"), 900);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${row.method} ${row.path}`}
      description={`${row.operationId ?? "operation"} · openapi.yaml`}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" size="sm" className="mr-auto" onClick={onOpenSpec}>
            <FileJson className="size-3.5" />
            Open spec
          </Button>
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}
            {copied ? "Copied" : "Copy cURL"}
          </Button>
          <Hint
            label={
              row.outcome === "skipped" ? "Needs a token fixture first" : "Run this operation again"
            }
          >
            <span className="inline-flex">
              <Button
                size="sm"
                onClick={startRetest}
                disabled={retest === "running" || row.outcome === "skipped"}
              >
                {retest === "running" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                {retest === "done" ? "Passed again" : "Re-test"}
              </Button>
            </span>
          </Hint>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <MethodChip method={row.method} />
          <EndpointStatus row={row} />
          <Badge variant="neutral" className="gap-1">
            <Timer className="size-3 text-sky-400" />
            {row.ms}ms
          </Badge>
          <Badge variant="neutral" className="font-mono">
            {row.operationId ?? "operation"}
          </Badge>
          {row.firstHttp !== undefined && (
            <Badge variant="warning" className="gap-1">
              <Wrench className="size-3" />
              first pass {row.firstHttp}
            </Badge>
          )}
        </div>

        {row.note && (
          <Alert variant={row.outcome === "skipped" ? "warning" : "info"}>
            {row.outcome === "skipped" ? <TriangleAlert /> : <Sparkles />}
            <div>
              <AlertTitle>
                {row.outcome === "skipped"
                  ? "Skipped, not passed"
                  : "What changed on the first pass"}
              </AlertTitle>
              <AlertDescription>{row.note}</AlertDescription>
            </div>
          </Alert>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
              Request
            </p>
            <CodeBlock
              lines={(
                row.request ?? `${row.method} ${row.path}\n# no fixture body for this operation`
              ).split("\n")}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
              Response
            </p>
            {row.response ? (
              <HighlightedCode code={row.response} language="json" className="max-h-40 min-h-24" />
            ) : (
              <CodeBlock lines={[String(row.http), "# no recorded body"]} />
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
            Execution log
          </p>
          <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/60 p-3">
            <LogLines lines={logs} />
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export function SpecDialog({
  open,
  onClose,
  focus,
}: {
  open: boolean;
  onClose: () => void;
  /** Opened from an endpoint: start on that operation's exact spec section. */
  focus?: EndpointRow;
}) {
  const [tab, setTab] = useState(focus ? "operation" : "spec");
  const contract = DIFFS["openapi.yaml"] ?? [];

  useEffect(() => {
    if (open) setTab(focus ? "operation" : "spec");
  }, [open, focus]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="openapi.yaml"
      description="14 operations · 3 documented paths · server http://127.0.0.1:3000"
      className="max-w-3xl"
      actions={
        <Hint label={tab === "contract" ? "Download contract test" : "Download spec"}>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={tab === "contract" ? "Download contract test" : "Download spec"}
            onClick={() =>
              downloadFile(
                tab === "contract" ? "openapi.contract.test.ts" : "openapi.yaml",
                tab === "contract" ? contract.join("\n") : SPEC_YAML,
              )
            }
          >
            <Download className="size-4" />
          </Button>
        </Hint>
      }
    >
      <div className="mb-2.5 flex items-start gap-2.5 rounded-xl border border-indigo-500/25 bg-indigo-500/[0.06] px-3 py-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-indigo-300" />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-zinc-200">
            Built from openapi.yaml — no model call
          </p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">
            EdgeSpec reads the spec and writes this contract test itself. Only test files are added;
            your application code is never modified.
          </p>
        </div>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as "operation" | "spec" | "contract")}
        className="space-y-2"
      >
        <TabsList>
          {focus && (
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
            Generated contract
          </TabsTrigger>
        </TabsList>

        {focus && (
          <TabsContent value="operation">
            <HighlightedCode code={specSection(SPEC_YAML, focus.path)} language="yaml" />
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
              Only this path from openapi.yaml. The full document and the generated contract are one
              tab away.
            </p>
          </TabsContent>
        )}

        <TabsContent value="spec">
          <HighlightedCode code={SPEC_YAML} language="yaml" />
        </TabsContent>
        <TabsContent value="contract">
          <HighlightedCode code={contract.join("\n")} language="typescript" />
        </TabsContent>
      </Tabs>
    </Dialog>
  );
}

/** The YAML slice for one path, so "Open spec" can land on the exact operation. */
function specSection(spec: string, path: string): string {
  const lines = spec.split("\n");
  const start = lines.findIndex((line) => line.trim() === `${path}:`);
  if (start === -1) return spec;
  const end = lines.findIndex((line, index) => index > start && /^ {2}\/[\w./{}]+:$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

export function FactsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const total = FACTS.languages.reduce((sum, language) => sum + language.count, 0);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Repository facts"
      description={`${FACTS.repo}@${FACTS.ref} · ${FACTS.files.toLocaleString()} files`}
      className="max-w-2xl"
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Source files", value: FACTS.sourceFiles },
            { label: "Test files", value: FACTS.testFiles },
            { label: "Runtime", value: FACTS.runtime },
            { label: "Package manager", value: FACTS.packageManager },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-2.5"
            >
              <p className="text-[10px] text-zinc-500">{item.label}</p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-200">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
            Languages
          </p>
          {FACTS.languages.map((language) => (
            <div key={language.name} className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-[11px] text-zinc-300">{language.name}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                <span
                  className="block h-full rounded-full bg-stage-clone"
                  style={{ width: `${(language.count / total) * 100}%` }}
                />
              </span>
              <span className="w-8 text-right font-mono text-[10px] text-zinc-500">
                {language.count}
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FACTS.frameworks.map((framework) => (
            <Badge key={framework} variant="neutral">
              {framework}
            </Badge>
          ))}
          <Badge variant="neutral">formatter · {FACTS.formatter}</Badge>
          <Badge variant="success">coverage · {FACTS.coverage.file}</Badge>
        </div>

        <Separator />

        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
            CI checks
          </p>
          {FACTS.checks.map((check) => (
            <div
              key={check.kind}
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
              <span className="truncate font-mono text-[10px] text-zinc-300">{check.command}</span>
              <CheckCircle2 className="ml-auto size-3.5 shrink-0 text-emerald-400" />
            </div>
          ))}
        </div>

        <Alert variant="info">
          <FileJson />
          <div>
            <AlertTitle>1 OpenAPI document</AlertTitle>
            <AlertDescription>
              openapi.yaml · 3 paths · 14 operations · bearer auth
            </AlertDescription>
          </div>
        </Alert>
      </div>
    </Dialog>
  );
}

export function PullsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Pull requests"
      description={`${RECENT_PRS.length} recent pull requests on acme/edge-api`}
      className="max-w-2xl"
    >
      <div className="space-y-1.5">
        {RECENT_PRS.map((pull) => (
          <div
            key={pull.number}
            className="flex items-center gap-2.5 rounded-xl border border-zinc-800/70 bg-zinc-950/40 px-3 py-2"
          >
            <GitPullRequest className="size-3.5 shrink-0 text-zinc-500" />
            <span className="font-mono text-[10px] text-zinc-500">#{pull.number}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-200">{pull.title}</span>
            <Badge variant="neutral">{pull.files} files</Badge>
            <Badge variant={pull.checks === "passing" ? "success" : "danger"}>{pull.checks}</Badge>
            <Badge
              variant={
                pull.state === "open" ? "accent" : pull.state === "merged" ? "success" : "neutral"
              }
            >
              {pull.state}
            </Badge>
          </div>
        ))}
      </div>
      <Alert variant="info" className="mt-3">
        <ListChecks />
        <div>
          <AlertTitle>One pull request per review</AlertTitle>
          <AlertDescription>
            A dispatched run opens a single pull request with every accepted test file.
          </AlertDescription>
        </div>
      </Alert>
    </Dialog>
  );
}

export function PrDialog({
  open,
  onClose,
  onDispatch,
  entries,
  endpoints,
  settings,
  value,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  onDispatch: () => void;
  entries: ReviewEntry[];
  endpoints: EndpointRow[];
  settings: DraftSettings;
  value: PrDraft;
  onChange: (next: PrDraft) => void;
}) {
  const [generating, setGenerating] = useState(false);
  const accepted = entries.filter((entry) => entry.state === "accepted");
  const rejected = entries.filter((entry) => entry.state === "rejected");
  const pending = entries.filter((entry) => entry.state === "pending");
  const skipped = endpoints.filter((row) => row.outcome === "skipped");
  const fixed = endpoints.filter((row) => row.firstHttp !== undefined && row.outcome !== "skipped");
  const blocked = accepted.length === 0 || pending.length > 0;
  const providerName = providerById(settings.provider)?.name ?? settings.provider;
  const files = accepted.map((entry) => entry.file.test);

  /** Draft copy only: the mockup never calls a provider. */
  const generate = () => {
    setGenerating(true);
    window.setTimeout(() => {
      onChange({
        ...value,
        title: `test: cover ${files.length || "the"} untested path${files.length === 1 ? "" : "s"}`,
        commit: `test: add ${files.length} generated test file${files.length === 1 ? "" : "s"}`,
        description: [
          "## Summary",
          "",
          `Generated with ${providerName} · ${settings.model} and verified on ${settings.sandboxProvider}.`,
          "",
          ...files.map((file) => `- ${file}`),
          "",
          "## Verification",
          "",
          "- format, lint, typecheck and the suite passed",
          `- ${fixed.length} contract test corrected from openapi.yaml`,
          `- App source unchanged; ${skipped.length} operation skipped for a missing fixture`,
        ].join("\n"),
      });
      setGenerating(false);
    }, 900);
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
                  ? `Resolve ${pending.length} pending file(s) first`
                  : "Open one pull request with the accepted tests"
            }
          >
            <span className="inline-flex">
              <Button onClick={onDispatch} disabled={blocked}>
                <GitPullRequest className="size-3.5" />
                Open {value.draft ? "draft " : ""}pull request · {accepted.length} file
                {accepted.length === 1 ? "" : "s"}
              </Button>
            </span>
          </Hint>
        </>
      }
    >
      <div className="space-y-2.5">
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
                {accepted.length} accepted, {rejected.length} rejected. Only the accepted tests are
                committed.
              </AlertDescription>
            </div>
          </Alert>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <Summary label="Repository" value={`${FACTS.repo} → main`} icon={FolderGit2} />
          <Summary
            label="Base branch"
            value="main"
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
            value={`${settings.sandboxProvider} · ${settings.strictTypes ? "strict" : "lenient"} · verified`}
            icon={ShieldCheck}
            iconClass="text-emerald-400"
          />
        </div>

        <div className="space-y-2 rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
              Pull request
            </p>
            <Button variant="outline" size="xs" onClick={generate} disabled={generating}>
              {generating ? (
                <Loader2 className="size-3.5 animate-spin text-fuchsia-400" />
              ) : (
                <Sparkles className="size-3.5 text-fuchsia-400" />
              )}
              {generating ? "Generating…" : "Generate with AI"}
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
                key={entry.file.test}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] px-2.5 py-1.5"
              >
                <FileCode2 className="size-3.5 shrink-0 text-emerald-400" />
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-200">
                  {entry.file.test}
                </span>
                <CheckSummary checks={CHECKS} />
              </div>
            ))
          )}
        </Section>

        <Section title={`Excluded (${rejected.length + skipped.length})`} tone="warning">
          {rejected.map((entry) => (
            <div
              key={entry.file.test}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/[0.04] px-2.5 py-1.5"
            >
              <X className="size-3.5 shrink-0 text-rose-400" />
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-200">
                {entry.file.test}
              </span>
              <span className="text-[10px] text-zinc-500">rejected by you</span>
            </div>
          ))}
          {skipped.map((row) => (
            <div
              key={`${row.method}-${row.path}`}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-2.5 py-1.5"
            >
              <TriangleAlert className="size-3.5 shrink-0 text-amber-400" />
              <MethodChip method={row.method} />
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-200">
                {row.path}
              </span>
              <span className="text-[10px] text-zinc-500">skipped · no fixture</span>
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
          <span>· {fixed.length} contract corrected</span>
          <span>· {skipped.length} skipped</span>
          <span>· no app source changes</span>
        </div>
      </div>
    </Dialog>
  );
}

const CHECK_META: Record<string, { icon: typeof AlignLeft; tone: string }> = {
  format: { icon: AlignLeft, tone: "text-zinc-500" },
  lint: { icon: ListChecks, tone: "text-zinc-500" },
  typecheck: { icon: Type, tone: "text-zinc-500" },
  test: { icon: FlaskConical, tone: "text-zinc-500" },
  build: { icon: ShieldCheck, tone: "text-zinc-500" },
};

const CHECK_STATUS = {
  passed: { icon: CheckCircle2, tone: "text-emerald-400" },
  warning: { icon: TriangleAlert, tone: "text-amber-400" },
  failed: { icon: X, tone: "text-rose-400" },
} as const;

const CI_TONE: Record<string, string> = {
  format: "text-sky-300",
  lint: "text-violet-300",
  typecheck: "text-amber-300",
  test: "text-emerald-300",
  build: "text-indigo-300",
};

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
