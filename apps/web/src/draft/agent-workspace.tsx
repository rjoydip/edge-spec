/**
 * Design draft for the four-step agent workspace (see REDESIGN.md).
 *
 * Fixtures only: no Worker, no GitHub, no keys. Mounted at `?draft` so the
 * shipped dashboard is untouched while the layout is reviewed.
 */
import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  Bot,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileCode2,
  FileDiff,
  Folder,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  KeyRound,
  Loader2,
  Moon,
  Play,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  Terminal,
  TriangleAlert,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertTitle,
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hint,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TooltipProvider,
  cn,
} from "@edge-spec/ui";
import { ACCENTS, setAccent, toggleMode, useAppearance } from "@/lib/theme";
import {
  DIFF,
  ENDPOINTS,
  FILES,
  GAPS,
  LOG_LINES,
  PHASE_RANK,
  type DraftEndpoint,
  type DraftGap,
  type DraftPhase,
} from "./data";

const TONES = {
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

type Tone = keyof typeof TONES;
type StageState = "idle" | "running" | "done";

const METHOD = {
  GET: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  POST: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  PUT: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  PATCH: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  DELETE: "border-rose-500/30 bg-rose-500/10 text-rose-400",
} as const;

const RISK = {
  high: { variant: "danger" as const, label: "H" },
  medium: { variant: "warning" as const, label: "M" },
  low: { variant: "neutral" as const, label: "L" },
};

const MODES = [
  {
    id: "review",
    label: "Interactive Review",
    desc: "Pause at every diff; dispatch by hand.",
    icon: ShieldCheck,
  },
  {
    id: "auto",
    label: "Fully Autonomous",
    desc: "Auto-accept, then open the PR once.",
    icon: Zap,
  },
] as const;

const GROUPS = GAPS.reduce<Record<string, DraftGap[]>>((all, gap) => {
  const dir = gap.path.split("/").slice(0, -1).join("/");
  (all[dir] ??= []).push(gap);
  return all;
}, {});

const STATUS_TEXT: Record<DraftPhase, string> = {
  idle: "Ready · acme/edge-api · main",
  scanning: "Cloning and parsing the tree",
  analyzing: "14 gaps found, ranking by risk",
  testing: "Contract tests executing on Docker",
  fixing: "Correcting the failing contract, writing tests",
  review: "8 tests ready · review, then dispatch",
  dispatched: "PR #128 opened on acme/edge-api",
};

export function AgentWorkspaceDraft() {
  const appearance = useAppearance();
  const [phase, setPhase] = useState<DraftPhase>("idle");
  const [tested, setTested] = useState(0);
  const [written, setWritten] = useState(0);
  const [fixed, setFixed] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [diffKey, setDiffKey] = useState(0);
  const [mode, setMode] = useState<"review" | "auto">("review");
  const [repo, setRepo] = useState("https://github.com/acme/edge-api.git");
  const [branch, setBranch] = useState("main");
  const [activePath, setActivePath] = useState(FILES[0] as string);
  const [selection, setSelection] = useState<string[]>(GAPS.slice(0, 8).map((gap) => gap.path));
  const [logOpen, setLogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const rank = PHASE_RANK[phase];
  const running = rank > 0 && rank < 5;

  // One pass through the four stages, so the motion is reviewable on load.
  useEffect(() => {
    const timer = setTimeout(() => setPhase("scanning"), 700);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (phase !== "scanning" && phase !== "analyzing") return;
    const next: DraftPhase = phase === "scanning" ? "analyzing" : "testing";
    const timer = setTimeout(() => setPhase(next), phase === "scanning" ? 1200 : 1500);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "testing") return;
    if (tested >= ENDPOINTS.length) {
      const timer = setTimeout(() => setPhase("fixing"), 600);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => setTested((count) => count + 1), 180);
    return () => clearTimeout(timer);
  }, [phase, tested]);

  useEffect(() => {
    if (phase !== "fixing") return;
    if (written >= 8) {
      const timer = setTimeout(() => {
        setFixed(true);
        setPhase("review");
      }, 700);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => setWritten((count) => count + 1), 150);
    return () => clearTimeout(timer);
  }, [phase, written]);

  // Autonomous mode accepts and dispatches once; the diff still appeared.
  useEffect(() => {
    if (phase !== "review" || mode !== "auto" || accepted) return;
    const timer = setTimeout(() => {
      setAccepted(true);
      setPhase("dispatched");
    }, 1700);
    return () => clearTimeout(timer);
  }, [phase, mode, accepted]);

  useEffect(() => {
    if (!regenerating) return;
    const timer = setTimeout(() => {
      setRegenerating(false);
      setDiffKey((key) => key + 1);
    }, 950);
    return () => clearTimeout(timer);
  }, [regenerating]);

  const reset = () => {
    setPhase("idle");
    setTested(0);
    setWritten(0);
    setFixed(false);
    setAccepted(false);
    setRegenerating(false);
    setDiffKey(0);
  };

  const start = () => {
    reset();
    setPhase("scanning");
  };

  const rows = ENDPOINTS.map((endpoint, index) => {
    const visible = index < tested || rank >= 5;
    const first = endpoint.firstHttp ?? endpoint.http;
    const pendingFix = endpoint.outcome === "fixed" && !fixed;
    return {
      ...endpoint,
      visible,
      wasHttp: first,
      http: pendingFix ? first : endpoint.http,
      outcome: pendingFix ? undefined : endpoint.outcome,
    };
  });
  const passed = rows.filter((row) => row.visible && row.http < 300).length;
  const fixedCount = rows.filter((row) => row.outcome === "fixed").length;
  const allSelected = selection.length === GAPS.length;

  const stages: Array<{
    id: number;
    label: string;
    sub: string;
    icon: typeof FolderGit2;
    tone: Tone;
    state: StageState;
    pct: number;
  }> = [
    {
      id: 1,
      label: "Cloned Repo",
      sub: rank >= 2 ? "2,140 files · AST parsed" : "git clone --depth 1",
      icon: FolderGit2,
      tone: "clone",
      state: rank >= 2 ? "done" : rank === 1 ? "running" : "idle",
      pct: rank >= 2 ? 100 : rank === 1 ? 55 : 0,
    },
    {
      id: 2,
      label: "Analyzed Gaps",
      sub: rank >= 2 ? `${GAPS.length} gaps · 11 missing` : "sibling test scan",
      icon: Search,
      tone: "analyze",
      state: rank >= 3 ? "done" : rank === 2 ? "running" : "idle",
      pct: rank >= 3 ? 100 : rank === 2 ? 60 : 0,
    },
    {
      id: 3,
      label: "Testing OpenSpec",
      sub: rank >= 3 ? `${tested}/${ENDPOINTS.length} endpoints` : "live execution",
      icon: Zap,
      tone: "test",
      state: rank >= 4 ? "done" : rank === 3 ? "running" : "idle",
      pct: (tested / ENDPOINTS.length) * 100,
    },
    {
      id: 4,
      label: "Fixing & Generating",
      sub: rank >= 4 ? `${written}/8 tests` : "bounded self-correction",
      icon: Wrench,
      tone: "fix",
      state: rank >= 5 ? "done" : rank === 4 ? "running" : "idle",
      pct: (written / 8) * 100,
    },
  ];

  const visibleLogs =
    rank === 0 ? [] : LOG_LINES.slice(0, Math.min(LOG_LINES.length, Math.max(2, rank * 2)));

  return (
    <TooltipProvider delayDuration={180}>
      <div className="no-scrollbar relative min-h-dvh overflow-x-hidden">
        <div className="app-backdrop" aria-hidden="true">
          <div className="app-aurora app-aurora-a" />
          <div className="app-aurora app-aurora-b" />
          <div className="app-aurora app-aurora-c" />
        </div>

        <div className="relative z-10 mx-auto max-w-7xl space-y-3 px-3 pt-3 pb-28 sm:px-6">
          <header className="app-reveal glass-panel sticky top-0 z-30 rounded-2xl px-3 py-2.5 sm:px-4">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={reset}
                title="Reset this draft run"
                aria-label="Reset this draft run"
                className="relative shrink-0 rounded-xl transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:outline-none"
              >
                <img
                  src="/favicon.svg"
                  alt=""
                  width={32}
                  height={32}
                  className="brand-mark size-8"
                />
                {running && (
                  <span className="absolute -top-0.5 -right-0.5 size-2 animate-pulse rounded-full bg-emerald-400 ring-2 ring-zinc-950" />
                )}
              </button>
              <div className="min-w-0 leading-tight">
                <h1 className="truncate text-sm font-bold tracking-tight text-zinc-50">
                  EdgeSpec <span className="text-zinc-400">AI Agent</span>
                </h1>
                <p className="hidden text-[10px] text-zinc-500 sm:block">
                  finds the gaps, tests the edges, opens the pull request
                </p>
              </div>

              <div className="ml-auto flex items-center gap-1.5">
                <Badge variant="warning" className="hidden h-9 items-center px-2 sm:inline-flex">
                  DRAFT
                </Badge>
                <Hint label="Workers AI · 1.2k calls left">
                  <Badge variant="accent" className="h-9 items-center gap-1 px-2.5">
                    <Bot className="size-3.5" />
                    1.2k
                  </Badge>
                </Hint>
                <Hint label="Docker sandbox · runs are verified">
                  <Badge
                    variant="neutral"
                    className="hidden h-9 items-center gap-1 px-2.5 sm:inline-flex"
                  >
                    <Boxes className="size-3.5 text-sky-400" />
                    Docker
                  </Badge>
                </Hint>
                <Hint label="Settings">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setSettingsOpen(true)}
                    aria-label="Open settings"
                  >
                    <Settings />
                  </Button>
                </Hint>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="User profile"
                      className="rounded-full transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:outline-none"
                    >
                      <Avatar>
                        <AvatarFallback>AC</AvatarFallback>
                      </Avatar>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuLabel>acme/edge-api · {branch}</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={toggleMode}>
                      {appearance.mode === "dark" ? <Sun /> : <Moon />}
                      {appearance.mode === "dark" ? "Light" : "Dark"} mode
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                      <KeyRound />
                      Provider & keys
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <GitPullRequest />
                      Pull requests
                      <span className="ml-auto font-mono text-[10px] text-zinc-500">3</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={reset}>
                      <RefreshCw />
                      Reset this run
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          {/* Step 1 */}
          <Card className="app-reveal overflow-hidden" style={{ animationDelay: "60ms" }}>
            <div className="h-0.5 w-full bg-gradient-to-r from-stage-clone via-stage-clone/40 to-transparent" />
            <CardContent className="space-y-3 p-4">
              <StepHead
                n="01"
                title="Target Repository"
                icon={FolderGit2}
                tone="clone"
                hint="clone · parse the AST · read the tree"
                aside={
                  <Badge variant="neutral" className="font-mono">
                    {repo.includes("acme") ? "acme/edge-api" : "invalid"}
                  </Badge>
                }
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <GitBranch className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-zinc-500" />
                  <Input
                    value={repo}
                    onChange={(event) => setRepo(event.target.value)}
                    aria-label="Repository URL"
                    spellCheck={false}
                    disabled={running}
                    className="pl-8 font-mono"
                  />
                </div>
                <Select value={branch} onValueChange={setBranch} disabled={running}>
                  <SelectTrigger aria-label="Branch" className="w-full font-mono sm:w-44">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <GitBranch className="size-3.5 shrink-0 text-zinc-500" />
                      <SelectValue />
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {["main", "develop", "release/1.4"].map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={running ? reset : start}
                  disabled={!repo.trim()}
                  className="sm:w-36"
                >
                  {running ? (
                    <>
                      <Square className="size-3.5 fill-current" />
                      Stop
                    </>
                  ) : (
                    <>
                      <Play className="size-3.5 fill-current" />
                      Start Scan
                    </>
                  )}
                </Button>
              </div>

              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <span className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
                  Mode
                </span>
                <RadioGroup
                  value={mode}
                  onValueChange={(value) => setMode(value as "review" | "auto")}
                  className="grid gap-2 sm:grid-cols-2 lg:flex-1"
                >
                  {MODES.map((option) => {
                    const Icon = option.icon;
                    const active = mode === option.id;
                    return (
                      <div
                        key={option.id}
                        onClick={() => setMode(option.id)}
                        className={cn(
                          "flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 transition",
                          active
                            ? "border-indigo-500/40 bg-indigo-500/10 shadow-lg shadow-indigo-950/20"
                            : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700",
                        )}
                      >
                        <RadioGroupItem
                          value={option.id}
                          id={`mode-${option.id}`}
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-200">
                            <Icon
                              className={cn(
                                "size-3.5",
                                active ? "text-indigo-300" : "text-zinc-500",
                              )}
                            />
                            {option.label}
                          </span>
                          <span className="block text-[10px] text-zinc-500">{option.desc}</span>
                        </span>
                      </div>
                    );
                  })}
                </RadioGroup>
              </div>
            </CardContent>
          </Card>

          {/* Step 2 */}
          <Card className="app-reveal overflow-hidden" style={{ animationDelay: "120ms" }}>
            <div className="h-0.5 w-full bg-gradient-to-r from-stage-analyze via-stage-analyze/40 to-transparent" />
            <CardContent className="space-y-3 p-4">
              <StepHead
                n="02"
                title="Live Pipeline Telemetry"
                icon={Activity}
                tone="analyze"
                hint="stages stream independently; counters come from events"
                aside={
                  <>
                    <Badge variant="neutral" className="gap-1">
                      <Clock className="size-3" />
                      {(rank * 2.4).toFixed(1)}s
                    </Badge>
                    <Button variant="ghost" size="xs" onClick={() => setLogOpen(true)}>
                      <Terminal className="size-3" />
                      Log
                    </Button>
                  </>
                }
              />
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                {stages.map((stage, index) => (
                  <Fragment key={stage.id}>
                    {index > 0 && (
                      <ChevronRight className="hidden size-3.5 shrink-0 text-zinc-600 md:block" />
                    )}
                    <StageNode {...stage} />
                  </Fragment>
                ))}
              </div>

              <Collapsible>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="group flex w-full items-center gap-2 rounded-lg border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-1.5 text-left text-[10px] text-zinc-500 transition hover:text-zinc-300"
                  >
                    <ChevronRight className="size-3 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                    <span className="truncate font-mono">
                      {visibleLogs[visibleLogs.length - 1]?.text ?? "waiting for the first event"}
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-zinc-600">
                      {visibleLogs.length} events
                    </span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 space-y-1 rounded-lg border border-zinc-800/70 bg-zinc-950/60 p-2.5 font-mono text-[10px] leading-relaxed">
                    {visibleLogs.map((entry, index) => (
                      <p key={index} className="flex gap-2">
                        <span className="shrink-0 text-zinc-600">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span
                          className={cn(
                            entry.level === "success" && "text-emerald-400",
                            entry.level === "warn" && "text-amber-400",
                            entry.level === "error" && "text-rose-400",
                            entry.level === "ai" && "text-violet-300",
                            entry.level === "info" && "text-zinc-400",
                          )}
                        >
                          {entry.text}
                        </span>
                      </p>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>

          {/* Step 3 */}
          <Card className="app-reveal overflow-hidden" style={{ animationDelay: "180ms" }}>
            <div className="h-0.5 w-full bg-gradient-to-r from-stage-test via-stage-test/40 to-transparent" />
            <CardContent className="space-y-3 p-4">
              <StepHead
                n="03"
                title="Triage & Findings"
                icon={ShieldCheck}
                tone="test"
                hint="what is missing, and what the contract actually says"
                aside={
                  <>
                    <Badge variant="warning">{GAPS.length} gaps</Badge>
                    <Badge variant={fixedCount ? "success" : "neutral"}>
                      {fixedCount ? `${fixedCount} corrected` : "0 corrected"}
                    </Badge>
                  </>
                }
              />

              <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                <div className="overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-950/30">
                  <div className="flex items-center justify-between gap-2 border-b border-zinc-800/60 px-3 py-2">
                    <span className="text-[10px] font-semibold text-zinc-400">
                      File tree / gaps <span className="text-zinc-600">({GAPS.length})</span>
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="neutral">{selection.length} selected</Badge>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setSelection(allSelected ? [] : GAPS.map((gap) => gap.path))}
                      >
                        {allSelected ? "Clear" : "All"}
                      </Button>
                    </div>
                  </div>
                  <ScrollArea className="h-[430px]">
                    <div className="p-1.5">
                      {Object.entries(GROUPS).map(([dir, files], groupIndex) => (
                        <Collapsible key={dir} defaultOpen={groupIndex < 3}>
                          <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] text-zinc-500 transition hover:text-zinc-300">
                            <ChevronRight className="size-3 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                            <Folder className="size-3.5 shrink-0 text-amber-400/80" />
                            <span className="truncate font-mono">{dir}</span>
                            <span className="ml-auto shrink-0 font-mono text-zinc-600">
                              {files.length}
                            </span>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            {files.map((gap) => {
                              const active = activePath === gap.path;
                              return (
                                <div
                                  key={gap.path}
                                  role="button"
                                  tabIndex={0}
                                  title={gap.path}
                                  onClick={() => setActivePath(gap.path)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      setActivePath(gap.path);
                                    }
                                  }}
                                  className={cn(
                                    "flex w-full cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 pl-6 text-left transition hover:bg-zinc-800/40",
                                    active && "bg-zinc-800/60",
                                  )}
                                >
                                  <Checkbox
                                    checked={selection.includes(gap.path)}
                                    onClick={(event) => event.stopPropagation()}
                                    onCheckedChange={(checked) =>
                                      setSelection((current) =>
                                        checked === true
                                          ? [...new Set([...current, gap.path])]
                                          : current.filter((path) => path !== gap.path),
                                      )
                                    }
                                    aria-label={`Select ${gap.path}`}
                                  />
                                  <FileCode2
                                    className={cn(
                                      "size-3.5 shrink-0",
                                      gap.kind === "api"
                                        ? "text-amber-400"
                                        : gap.kind === "coverage"
                                          ? "text-sky-400"
                                          : "text-zinc-500",
                                    )}
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate font-mono text-[11px] text-zinc-300">
                                      {gap.path.split("/").pop()}
                                    </span>
                                    <span className="block truncate text-[10px] text-zinc-600">
                                      {gap.note}
                                    </span>
                                  </span>
                                  <Badge variant={RISK[gap.risk].variant}>
                                    {RISK[gap.risk].label}
                                  </Badge>
                                </div>
                              );
                            })}
                          </CollapsibleContent>
                        </Collapsible>
                      ))}
                    </div>
                  </ScrollArea>
                </div>

                <div className="overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-950/30">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/60 px-3 py-2">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-400">
                      <Zap className="size-3.5 text-amber-400" />
                      OpenAPI health matrix
                      <Badge variant="neutral" className="ml-1 font-mono">
                        openapi.yaml
                      </Badge>
                    </span>
                    <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                      {rank === 3 ? (
                        <>
                          <Loader2 className="size-3 animate-spin text-amber-400" />
                          live
                        </>
                      ) : rank >= 4 ? (
                        <>
                          <CheckCircle2 className="size-3 text-emerald-400" />
                          {passed} passed
                        </>
                      ) : (
                        "not run"
                      )}
                    </span>
                  </div>
                  <ScrollArea className="h-[430px]">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="pl-3">Endpoint</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="pr-3 text-right">Time</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((row, index) => (
                          <TableRow
                            key={`${row.method}-${row.path}`}
                            className={cn(
                              "matrix-row",
                              row.outcome === "fixed" && "bg-emerald-500/[0.05]",
                            )}
                            style={{ animationDelay: `${Math.min(index, 12) * 24}ms` }}
                          >
                            <TableCell className="pl-3">
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    className="flex min-w-0 items-center gap-2 text-left"
                                  >
                                    <span
                                      className={cn(
                                        "inline-flex w-14 shrink-0 justify-center rounded border px-1 py-0.5 font-mono text-[9px] font-bold",
                                        METHOD[row.method],
                                      )}
                                    >
                                      {row.method}
                                    </span>
                                    <span className="truncate font-mono text-[11px] text-zinc-300">
                                      {row.path}
                                    </span>
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-80">
                                  <p className="flex items-center gap-2 font-mono text-[11px] text-zinc-200">
                                    <span
                                      className={cn(
                                        "inline-flex w-14 justify-center rounded border px-1 py-0.5 text-[9px] font-bold",
                                        METHOD[row.method],
                                      )}
                                    >
                                      {row.method}
                                    </span>
                                    {row.path}
                                  </p>
                                  <Separator className="my-2" />
                                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                                    <dt className="text-zinc-500">Spec</dt>
                                    <dd className="font-mono text-zinc-300">openapi.yaml</dd>
                                    <dt className="text-zinc-500">HTTP</dt>
                                    <dd className="font-mono text-zinc-300">
                                      {row.visible ? row.http : "not run"}
                                    </dd>
                                    <dt className="text-zinc-500">Time</dt>
                                    <dd className="font-mono text-zinc-300">
                                      {row.visible ? `${row.ms}ms` : "—"}
                                    </dd>
                                    <dt className="text-zinc-500">Result</dt>
                                    <dd className="text-zinc-300">
                                      {row.outcome === "fixed"
                                        ? `${row.wasHttp} on the first pass, passes after the test correction. The app was not modified.`
                                        : (row.note ?? "The contract test passed as written.")}
                                    </dd>
                                  </dl>
                                </PopoverContent>
                              </Popover>
                            </TableCell>
                            <TableCell>
                              {row.visible ? (
                                <StatusBadge row={row} />
                              ) : (
                                <Skeleton className="h-4 w-20" />
                              )}
                            </TableCell>
                            <TableCell className="pr-3 text-right font-mono text-[10px] text-zinc-500">
                              {row.visible ? `${row.ms}ms` : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                  <div className="flex items-center gap-1.5 border-t border-zinc-800/60 px-3 py-1.5 text-[10px] text-zinc-500">
                    <Server className="size-3" />
                    {rank >= 3
                      ? "executed on the Docker sandbox"
                      : "needs a runner · static check only"}
                    <span className="ml-auto font-mono">
                      {passed}/{ENDPOINTS.length}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Step 4 */}
          <Card className="app-reveal overflow-hidden" style={{ animationDelay: "240ms" }}>
            <div className="h-0.5 w-full bg-gradient-to-r from-stage-review via-stage-review/40 to-transparent" />
            <CardContent className="space-y-3 p-4">
              <StepHead
                n="04"
                title="Code Diff Review"
                icon={FileDiff}
                tone="review"
                hint="the generated test, verified before it leaves"
                aside={
                  <>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="max-w-52 font-mono text-[10px]"
                        >
                          <FileCode2 className="size-3.5" />
                          <span className="truncate">{activePath.split("/").pop()}</span>
                          <ChevronDown className="size-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64">
                        <DropdownMenuLabel>Generated tests</DropdownMenuLabel>
                        {FILES.map((file) => (
                          <DropdownMenuItem
                            key={file}
                            className="font-mono text-[10px]"
                            onSelect={() => setActivePath(file)}
                          >
                            {file}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRegenerating(true)}
                      disabled={rank < 5 || regenerating}
                    >
                      <RefreshCw className={cn("size-3.5", regenerating && "animate-spin")} />
                      Regenerate
                    </Button>
                    <Button
                      size="sm"
                      variant={accepted ? "secondary" : "default"}
                      onClick={() => setAccepted(true)}
                      disabled={rank < 5 || accepted}
                    >
                      <Check className="size-3.5" />
                      {accepted ? "Accepted" : "Accept"}
                    </Button>
                  </>
                }
              />

              <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <FolderGit2 className="size-3.5" />
                <span className="font-mono text-zinc-300">
                  {activePath.replace(/\.ts$/, ".test.ts")}
                </span>
                <Badge variant="success">generated</Badge>
                <Badge variant="neutral">bun:test</Badge>
                <span className="ml-auto flex items-center gap-1">
                  <Sparkles className="size-3 text-violet-400" />
                  claude-sonnet-4 · 2.4s
                </span>
              </div>

              <div className="overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-950/50">
                <div className="flex items-center gap-2 border-b border-zinc-800/60 bg-zinc-900/60 px-3 py-1.5 font-mono text-[10px] text-zinc-500">
                  <FileCode2 className="size-3" />
                  @@ -0,0 +1,{DIFF.length} @@
                  <span className="ml-auto">
                    {regenerating ? "regenerating…" : accepted ? "accepted" : "pending review"}
                  </span>
                </div>
                <div className="no-scrollbar max-h-[430px] overflow-auto py-1">
                  {DIFF.map((line, index) => (
                    <DiffRow key={`${diffKey}-${index}`} line={line} index={index} />
                  ))}
                </div>
              </div>

              {rank >= 5 ? (
                <Alert variant="success">
                  <ShieldCheck />
                  <div>
                    <AlertTitle>Verified on Docker · 8/8 passed</AlertTitle>
                    <AlertDescription>
                      The suite executed in 412ms, exit 0. This is a real run, not a static check.
                    </AlertDescription>
                  </div>
                </Alert>
              ) : (
                <Alert variant="warning">
                  <TriangleAlert />
                  <div>
                    <AlertTitle>Not verified yet</AlertTitle>
                    <AlertDescription>
                      No runner has executed this suite. A static check is not a pass.
                    </AlertDescription>
                  </div>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3 sm:px-6">
          <div className="glass-panel relative mx-auto flex max-w-7xl flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2 text-[11px] text-zinc-400">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  rank >= 5
                    ? "bg-emerald-400"
                    : running
                      ? "animate-pulse bg-amber-400"
                      : "bg-zinc-600",
                )}
              />
              <span className="truncate">{STATUS_TEXT[phase]}</span>
              {rank >= 5 && (
                <Badge variant="success" className="ml-1 hidden sm:inline-flex">
                  {accepted ? "8 accepted" : `${selection.length} ready`}
                </Badge>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {running ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <X className="size-3.5" />
                      Cancel
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Stop this run?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The stream closes and the generated tests stay in this session. No pull
                        request is opened.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep running</AlertDialogCancel>
                      <AlertDialogAction variant="danger" onClick={reset}>
                        Stop run
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <Button variant="ghost" size="sm" onClick={reset} disabled={phase === "idle"}>
                  <X className="size-3.5" />
                  Cancel
                </Button>
              )}
              <Button
                onClick={() => {
                  setAccepted(true);
                  setPhase("dispatched");
                }}
                disabled={rank < 5 || (!accepted && mode === "review") || phase === "dispatched"}
                title={
                  rank < 5
                    ? "A run has to finish first"
                    : !accepted && mode === "review"
                      ? "Accept a diff, or switch to Fully Autonomous"
                      : "Open one pull request with the accepted tests"
                }
                className="bg-gradient-to-r from-indigo-600 to-violet-600 shadow-lg shadow-indigo-950/30"
              >
                {phase === "dispatched" ? (
                  <>
                    <CheckCircle2 />
                    PR #128 opened
                  </>
                ) : (
                  <>
                    <GitPullRequest />
                    Dispatch Pull Request
                    <ArrowUpRight className="size-3.5" />
                  </>
                )}
              </Button>
            </div>
            {phase === "dispatched" && (
              <span className="success-burst pointer-events-none absolute right-10 bottom-12 flex gap-1.5">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                <span className="size-1.5 rounded-full bg-sky-400" />
                <span className="size-1.5 rounded-full bg-violet-400" />
              </span>
            )}
          </div>
        </div>

        <Sheet open={logOpen} onOpenChange={setLogOpen}>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Run log</SheetTitle>
              <SheetDescription>Every event names the stage that produced it.</SheetDescription>
            </SheetHeader>
            <SheetBody>
              <div className="space-y-1.5 font-mono text-[11px]">
                {LOG_LINES.map((entry, index) => (
                  <p key={index} className="flex gap-2">
                    <span className="shrink-0 text-zinc-600">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={cn(
                        entry.level === "success" && "text-emerald-400",
                        entry.level === "warn" && "text-amber-400",
                        entry.level === "ai" && "text-violet-300",
                        entry.level === "info" && "text-zinc-400",
                      )}
                    >
                      {entry.text}
                    </span>
                  </p>
                ))}
              </div>
            </SheetBody>
            <SheetFooter>
              <Button variant="outline" size="sm" onClick={() => setLogOpen(false)}>
                Close
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Settings</SheetTitle>
              <SheetDescription>Draft only — the shipped dialog is unchanged.</SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-4">
              <div>
                <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
                  Appearance
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {ACCENTS.map((accent) => (
                    <button
                      key={accent.id}
                      type="button"
                      onClick={() => setAccent(accent.base)}
                      title={accent.name}
                      aria-label={accent.name}
                      style={{ background: accent.base }}
                      className={cn(
                        "size-6 rounded-full ring-2 ring-offset-2 ring-offset-zinc-950 transition hover:scale-110",
                        appearance.accentId === accent.id ? "ring-white/80" : "ring-transparent",
                      )}
                    />
                  ))}
                </div>
                <Button variant="outline" size="sm" className="mt-3" onClick={toggleMode}>
                  {appearance.mode === "dark" ? <Sun /> : <Moon />}
                  {appearance.mode === "dark" ? "Light" : "Dark"} mode
                </Button>
              </div>
              <Separator />
              <div className="space-y-1.5">
                {[
                  { icon: Bot, label: "AI provider", value: "Workers AI · llama-4-scout" },
                  { icon: Boxes, label: "Sandbox", value: "Docker · verified runs" },
                  { icon: KeyRound, label: "Keys", value: "sent as headers, never stored" },
                  { icon: Wrench, label: "Pipeline", value: "3 retries · 6 files · strict types" },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center gap-2.5 rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-3 py-2"
                  >
                    <row.icon className="size-3.5 shrink-0 text-zinc-500" />
                    <span className="text-[11px] font-medium text-zinc-300">{row.label}</span>
                    <span className="ml-auto truncate font-mono text-[10px] text-zinc-500">
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
              <Alert variant="info">
                <Sparkles />
                <div>
                  <AlertTitle>Fixtures, not a live run</AlertTitle>
                  <AlertDescription>
                    This page exists to review layout and motion. The real dashboard still runs at
                    the root URL.
                  </AlertDescription>
                </div>
              </Alert>
            </SheetBody>
            <SheetFooter>
              <Button size="sm" onClick={() => setSettingsOpen(false)}>
                Done
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}

function StepHead({
  n,
  title,
  hint,
  icon: Icon,
  tone,
  aside,
}: {
  n: string;
  title: string;
  hint: string;
  icon: typeof FolderGit2;
  tone: Tone;
  aside?: ReactNode;
}) {
  const palette = TONES[tone];
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg border font-mono text-[11px] font-bold",
          palette.border,
          palette.soft,
          palette.text,
        )}
      >
        {n}
      </span>
      <div className="min-w-0">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-100">
          <Icon className={cn("size-3.5", palette.text)} />
          {title}
        </h2>
        <p className="text-[10px] text-zinc-500">{hint}</p>
      </div>
      {aside && <div className="ml-auto flex flex-wrap items-center gap-1.5">{aside}</div>}
    </div>
  );
}

function StageNode({
  label,
  sub,
  icon: Icon,
  tone,
  state,
  pct,
  id,
}: {
  id: number;
  label: string;
  sub: string;
  icon: typeof FolderGit2;
  tone: Tone;
  state: StageState;
  pct: number;
}) {
  const palette = TONES[tone];
  const running = state === "running";
  const done = state === "done";
  return (
    <div
      className={cn(
        "pipeline-node relative min-w-0 flex-1 rounded-xl border px-2.5 py-2 transition-all",
        done
          ? cn(palette.border, "bg-zinc-900/70")
          : running
            ? cn(palette.border, palette.soft, "shadow-lg", palette.glow)
            : "border-zinc-800/80 bg-zinc-900/40",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "relative flex size-7 shrink-0 items-center justify-center rounded-lg border bg-zinc-950/40",
            done
              ? "border-emerald-500/40 text-emerald-400"
              : running
                ? cn(palette.border, palette.text, "stage-ping")
                : "border-zinc-800 text-zinc-500",
          )}
        >
          {done ? (
            <Check className="size-3.5" strokeWidth={3} />
          ) : running ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Icon className="size-3.5" />
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold text-zinc-200">{label}</p>
          <p className="truncate font-mono text-[10px] text-zinc-500">{sub}</p>
        </div>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-600">0{id}</span>
      </div>
      <Progress
        value={pct}
        aria-label={`${label} progress`}
        className="mt-2 h-1"
        indicatorClassName={done ? "bg-emerald-500" : palette.bar}
      />
    </div>
  );
}

function StatusBadge({
  row,
}: {
  row: DraftEndpoint & { visible: boolean; wasHttp: number; http: number };
}) {
  if (row.outcome === "fixed") {
    return (
      <Badge variant="success" className="gap-1">
        <Wrench className="size-3" />
        {row.wasHttp} → {row.http}
      </Badge>
    );
  }
  if (row.outcome === "skipped") {
    return (
      <Badge variant="warning" className="gap-1">
        <TriangleAlert className="size-3" />
        skipped
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

function DiffRow({ line, index }: { line: string; index: number }) {
  const blank = line.trim() === "";
  return (
    <div
      className={cn(
        "diff-line flex gap-3 px-3 font-mono text-[11px] leading-5",
        !blank && "bg-emerald-500/[0.06]",
      )}
      style={{ animationDelay: `${Math.min(index, 30) * 12}ms` }}
    >
      <span className="w-6 shrink-0 text-right text-[10px] text-zinc-500 select-none">
        {index + 1}
      </span>
      <span className={cn("w-2 shrink-0", blank ? "text-zinc-600" : "text-emerald-400")}>
        {blank ? "" : "+"}
      </span>
      <span className="min-w-0 whitespace-pre-wrap break-words text-zinc-300">{line || " "}</span>
    </div>
  );
}
