/** Every modal the four-step workspace opens. Fixtures only. */
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clipboard,
  Download,
  FileCode2,
  FileJson,
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
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
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
  CheckChips,
  EndpointStatus,
  LogLines,
  MethodChip,
  STAGE_LABEL,
  downloadFile,
  type EndpointRow,
} from "./shared";
import type { DraftSettings } from "./settings-sheet";

export type ReviewState = "pending" | "accepted" | "rejected";

export interface ReviewEntry {
  file: GeneratedFile;
  state: ReviewState;
}

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
      className="max-w-4xl"
      footer={
        <>
          <Button
            variant="outline"
            size="sm"
            className="mr-auto"
            onClick={() =>
              downloadFile(
                `edgespec-run-${stage}.log`,
                lines
                  .map((line) => `${line.at} [${line.stage}] ${line.level} ${line.text}`)
                  .join("\n"),
              )
            }
          >
            <Download className="size-3.5" />
            Download log
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </>
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

export function ReviewDialog({
  open,
  onClose,
  entry,
  onState,
  onRegenerate,
  regenerating,
  onPrev,
  onNext,
}: {
  open: boolean;
  onClose: () => void;
  entry?: ReviewEntry;
  onState: (state: ReviewState) => void;
  onRegenerate: () => void;
  regenerating: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [tab, setTab] = useState("test");
  useEffect(() => setTab("test"), [entry?.file.source]);

  if (!entry) return null;
  const diff = DIFFS[entry.file.source] ?? [];
  const source = SOURCES[entry.file.source] ?? [];
  const state = entry.state;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={entry.file.test}
      description={`Generated from ${entry.file.source} with ${entry.file.provider} · ${entry.file.model}`}
      className="max-w-5xl"
      footer={
        <>
          <div className="mr-auto flex flex-wrap items-center gap-1.5">
            <Button variant="ghost" size="xs" onClick={onPrev} aria-label="Previous file">
              <ArrowLeft className="size-3.5" />
            </Button>
            <Button variant="ghost" size="xs" onClick={onNext} aria-label="Next file">
              <ArrowRight className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={() =>
                downloadFile(
                  entry.file.test.split("/").pop() ?? "test.ts",
                  diff.join("\n"),
                  "text/typescript",
                )
              }
            >
              <Download className="size-3.5" />
              Download
            </Button>
            <Button variant="outline" size="xs" onClick={onRegenerate} disabled={regenerating}>
              <RefreshCw className={cn("size-3.5", regenerating && "animate-spin")} />
              {regenerating ? "Writing…" : "Regenerate"}
            </Button>
          </div>
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
          <CheckChips checks={CHECKS} />
          <Badge
            variant={state === "accepted" ? "success" : state === "rejected" ? "danger" : "warning"}
          >
            {state}
          </Badge>
          <span className="ml-auto flex items-center gap-1 text-[10px] text-zinc-500">
            <Sparkles className="size-3 text-violet-400" />
            {entry.file.model} · 2.4s
          </span>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="space-y-2">
          <TabsList>
            <TabsTrigger value="test">
              <FileCode2 className="size-3.5" />
              Generated test
            </TabsTrigger>
            <TabsTrigger value="source">
              <FileJson className="size-3.5" />
              {entry.file.source === "openapi.yaml" ? "Spec source" : "Source file"}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="test">
            <CodeBlock lines={diff} kind="add" />
          </TabsContent>
          <TabsContent value="source">
            <CodeBlock lines={source} />
          </TabsContent>
        </Tabs>

        <Alert variant="success">
          <ShieldCheck />
          <div>
            <AlertTitle>Executed on Docker · exit 0</AlertTitle>
            <AlertDescription>
              format, lint, typecheck and the suite passed in 412ms. The source file was not
              modified.
            </AlertDescription>
          </div>
        </Alert>

        {state === "rejected" && (
          <Alert variant="warning">
            <TriangleAlert />
            <div>
              <AlertTitle>Excluded from the pull request</AlertTitle>
              <AlertDescription>
                This test stays in the session. Restore it to put it back in the PR package.
              </AlertDescription>
            </div>
          </Alert>
        )}
      </div>
    </Dialog>
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
      className="max-w-3xl"
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
          <Button
            size="sm"
            onClick={startRetest}
            disabled={retest === "running" || row.outcome === "skipped"}
            title={
              row.outcome === "skipped" ? "Needs a token fixture first" : "Run this operation again"
            }
          >
            {retest === "running" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {retest === "done" ? "Passed again" : "Re-test"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <MethodChip method={row.method} />
          <EndpointStatus row={row} />
          <Badge variant="neutral" className="gap-1">
            <Timer className="size-3" />
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
            <CodeBlock lines={(row.response ?? `${row.http}\n# no recorded body`).split("\n")} />
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

export function SpecDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState("spec");
  const specLines = SPEC_YAML.split("\n");
  const contract = DIFFS["openapi.yaml"] ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="openapi.yaml"
      description="14 operations · 3 documented paths · server http://127.0.0.1:3000"
      className="max-w-4xl"
      footer={
        <>
          <Button
            variant="outline"
            size="sm"
            className="mr-auto"
            onClick={() =>
              downloadFile(
                tab === "spec" ? "openapi.yaml" : "openapi.contract.test.ts",
                tab === "spec" ? SPEC_YAML : contract.join("\n"),
              )
            }
          >
            <Download className="size-3.5" />
            Download {tab === "spec" ? "spec" : "contract test"}
          </Button>
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="space-y-2">
        <TabsList>
          <TabsTrigger value="spec">
            <FileJson className="size-3.5" />
            Spec source
          </TabsTrigger>
          <TabsTrigger value="contract">
            <FileCode2 className="size-3.5" />
            Generated contract
          </TabsTrigger>
        </TabsList>
        <TabsContent value="spec">
          <CodeBlock lines={specLines} />
        </TabsContent>
        <TabsContent value="contract">
          <CodeBlock lines={contract} kind="add" />
        </TabsContent>
      </Tabs>
      <Alert variant="info" className="mt-3">
        <ShieldCheck />
        <div>
          <AlertTitle>Deterministic, not AI-written</AlertTitle>
          <AlertDescription>
            The contract suite is built from the spec. Only the source file is downloaded or
            committed; the app is never edited.
          </AlertDescription>
        </div>
      </Alert>
    </Dialog>
  );
}

export function FactsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const total = FACTS.languages.reduce((sum, language) => sum + language.count, 0);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Repository facts"
      description={`${FACTS.repo}@${FACTS.ref} · ${FACTS.files.toLocaleString()} files`}
      className="max-w-3xl"
      footer={
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      }
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
              <span className="w-20 shrink-0 font-mono text-[10px] text-indigo-300">
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
      footer={
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      }
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
          <AlertTitle>One PR per review</AlertTitle>
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
}: {
  open: boolean;
  onClose: () => void;
  onDispatch: () => void;
  entries: ReviewEntry[];
  endpoints: EndpointRow[];
  settings: DraftSettings;
}) {
  const accepted = entries.filter((entry) => entry.state === "accepted");
  const rejected = entries.filter((entry) => entry.state === "rejected");
  const pending = entries.filter((entry) => entry.state === "pending");
  const skipped = endpoints.filter((row) => row.outcome === "skipped");
  const fixed = endpoints.filter((row) => row.firstHttp !== undefined && row.outcome !== "skipped");
  const blocked = accepted.length === 0 || pending.length > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Pull request package"
      description="Exactly what leaves this session. Nothing else is committed."
      className="max-w-3xl"
      footer={
        <>
          <Button variant="ghost" size="sm" className="mr-auto" onClick={onClose}>
            Back to review
          </Button>
          <Button
            onClick={onDispatch}
            disabled={blocked}
            title={
              accepted.length === 0
                ? "Accept at least one test"
                : pending.length > 0
                  ? `Resolve ${pending.length} pending file(s) first`
                  : "Open one pull request with the accepted tests"
            }
          >
            <GitPullRequest className="size-3.5" />
            Open pull request · {accepted.length} file{accepted.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {pending.length > 0 ? (
          <Alert variant="warning">
            <TriangleAlert />
            <div>
              <AlertTitle>{pending.length} file(s) still pending</AlertTitle>
              <AlertDescription>
                Accept or reject them before opening the PR, so nothing is dropped silently.
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
          <Summary label="Branch" value="edgespec/tests-2026-10-25" icon={GitPullRequest} />
          <Summary
            label="Model"
            value={`${providerById(settings.provider)?.name ?? settings.provider} · ${settings.model}`}
            icon={Sparkles}
          />
          <Summary
            label="Verification"
            value={`${settings.sandboxProvider} · ${settings.strictTypes ? "strict" : "lenient"} · verified`}
            icon={ShieldCheck}
          />
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
                <CheckChips checks={CHECKS} />
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

        <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-3 text-[11px] text-zinc-400">
          <p className="flex items-center gap-1.5 font-semibold text-zinc-200">
            <Wrench className="size-3.5 text-stage-fix" />
            What the commit contains
          </p>
          <ul className="mt-1.5 space-y-1 text-[10px]">
            <li>· {accepted.length} generated test files, one commit, no app source changes.</li>
            <li>· {fixed.length} contract test corrected from the spec, not the application.</li>
            <li>· {skipped.length} operation skipped and named in the PR body.</li>
            <li>
              · Checks: format, lint, typecheck and the suite ran on {settings.sandboxProvider}.
            </li>
          </ul>
        </div>
      </div>
    </Dialog>
  );
}

function Summary({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof FolderGit2;
}) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-2">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-zinc-500" />
      <div className="min-w-0">
        <p className="text-[10px] text-zinc-500">{label}</p>
        <p className="truncate font-mono text-[10px] text-zinc-200">{value}</p>
      </div>
    </div>
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
