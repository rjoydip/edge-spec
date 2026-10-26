import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApiTestResult,
  CoverageStatus,
  Gap,
  GeneratedTest,
  Generation,
  RateLimitInfo,
  RepositoryOverview,
  RetestOperation,
  RunEvent,
  ScanTotals,
  ScanTruncation,
  StepId,
  Validation,
} from "@edge-spec/core/types";
import {
  fetchQuota,
  openPullWithFiles,
  regenerate,
  runPipelineStream,
  scanRepo,
  type PullMeta,
} from "@/api";
import { AgentWorkspace } from "@/components/agent/workspace";
import { SettingsSheet, type SettingsSection } from "@/components/agent/settings-sheet";
import { INITIAL_STEPS, type LogEntry, type LogLevel, type Steps } from "@/components/agent/shared";
import {
  getProject,
  getSettings,
  setProject,
  useProject,
  useSecrets,
  useSettings,
} from "@/lib/settings";

/** The provider refused the request because the quota is gone. */
function isQuotaError(message: string): boolean {
  return /quota|allocation|insufficient|rate limit|too many requests|\b429\b|neurons/i.test(
    message,
  );
}

/** The provider could not do the job: no quota, no answer, or no route. */
function isProviderError(message: string): boolean {
  return isQuotaError(message) || /did not answer within|unreachable|timed? ?out/i.test(message);
}

/** A manual stop aborts the stream; never surface that as a failure. */
function isAbortError(message: string): boolean {
  return /signal is aborted|aborted/i.test(message);
}

/** The title a provider problem gets in a toast. */
function providerErrorTitle(message: string): string {
  if (isQuotaError(message)) return "The provider refused the request";
  if (/did not answer within/i.test(message)) return "The provider did not answer in time";
  if (/unreachable/i.test(message)) return "The provider is unreachable";
  return "Generation failed";
}

interface Toast {
  title: string;
  description?: string;
  variant: "default" | "success" | "warning";
}

const clock = (): string => new Date().toLocaleTimeString("en-GB", { hour12: false });

/** One log line that says why validation failed, not just that it did. */
const failureSummary = (output: string, max = 1200): string => {
  const text = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" · ");
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export function App() {
  const project = useProject();
  const settings = useSettings();
  const secrets = useSecrets();

  const [settingsOpen, setSettingsOpen] = useState(false);
  /** The settings section the dialog scrolls to when it opens. */
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [apiResults, setApiResults] = useState<ApiTestResult[]>([]);
  /** True when the current API results came from a failed-endpoint retest. */
  const [wasRetest, setWasRetest] = useState(false);
  /** The log of the missing tests, apart from the pipeline run. */
  const [gapLogs, setGapLogs] = useState<LogEntry[]>([]);
  const [steps, setSteps] = useState<Steps>(INITIAL_STEPS);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [overview, setOverview] = useState<RepositoryOverview>();
  /** The test being written or previewed right now, one pair per source path. */
  const [live, setLive] = useState<
    Record<string, { generation?: Generation; validation?: Validation }>
  >({});
  /** Category totals and honesty flags from the last scan. */
  const [scanTotals, setScanTotals] = useState<ScanTotals>();
  const [scanTruncated, setScanTruncated] = useState<ScanTruncation>();
  const [coverageStatus, setCoverageStatus] = useState<CoverageStatus>();
  const [coverageReason, setCoverageReason] = useState<string>();
  const [generated, setGenerated] = useState<GeneratedTest[]>([]);
  /** What the provider says about the calls it has left. */
  const [quota, setQuota] = useState<RateLimitInfo>();
  /** The last refusal from the provider, e.g. an exhausted allocation. */
  const [providerError, setProviderError] = useState<string>();
  const [pullUrls, setPullUrls] = useState<Record<string, string>>({});
  /** The run the history table knows, when the deployment has D1. */
  const [runId, setRunId] = useState<string>();
  const [running, setRunning] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [generating, setGenerating] = useState(false);
  /** Paths whose generation is in flight right now: per-item spinner. */
  const [generatingPaths, setGeneratingPaths] = useState<string[]>([]);
  const [toast, setToast] = useState<Toast>();

  const abortRef = useRef<AbortController | null>(null);
  /** The running generation, so it can be stopped. */
  const generationAbortRef = useRef<AbortController | null>(null);
  /** How many generation batches are in flight; parallel mode allows more than one. */
  const activeBatches = useRef(0);
  const logId = useRef(0);
  const gapLogId = useRef(0);
  /** The pipeline stage that is running, so its log entries can be filtered. */
  const currentStep = useRef<StepId | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const addLog = useCallback((level: LogLevel, text: string, step?: StepId) => {
    logId.current += 1;
    setLogs((current) => [
      ...current,
      { id: logId.current, level, time: clock(), text, ...(step ? { step } : {}) },
    ]);
  }, []);

  // The missing tests have their own log: a generation or a pull request must
  // not bury the run log of a pipeline.
  const addGapLog = useCallback((level: LogLevel, text: string) => {
    gapLogId.current += 1;
    setGapLogs((current) => [...current, { id: gapLogId.current, level, time: clock(), text }]);
  }, []);

  const showToast = useCallback((next: Toast) => {
    setToast(next);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), 4500);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  // Ask the provider how many calls are left. It runs on launch and whenever
  // the provider, the model or the key changes.
  useEffect(() => {
    let cancelled = false;
    setQuota(undefined);
    fetchQuota(project, settings)
      .then((result) => {
        if (!cancelled && result.rateLimit) setQuota(result.rateLimit);
      })
      .catch(() => {
        // A provider that cannot be asked is a provider we know nothing about.
      });
    return () => {
      cancelled = true;
    };
    // The key itself is a secret: the probe only needs to know that it exists.
  }, [settings.provider, settings.model, settings.accountId, secrets.aiKey, project.repo]);

  // A test joins the ready list once it has both code and a validation result.
  useEffect(() => {
    const pairs = Object.values(live).filter(
      (item): item is { generation: Generation; validation: Validation } =>
        Boolean(item.generation && item.validation),
    );
    if (pairs.length === 0) return;
    setGenerated((current) => {
      let next = current;
      for (const { generation, validation } of pairs) {
        const index = next.findIndex(
          (item) => item.generation.sourcePath === generation.sourcePath,
        );
        const existing = next[index];
        if (
          existing &&
          existing.generation.code === generation.code &&
          existing.validation === validation
        ) {
          continue;
        }
        const item = { generation, validation };
        if (index === -1) {
          next = [...next, item];
        } else {
          const copy = next.slice();
          copy[index] = item;
          next = copy;
        }
      }
      return next;
    });
  }, [live]);

  const handleEvent = useCallback(
    (event: RunEvent) => {
      switch (event.type) {
        case "run":
          setRunId(event.id);
          break;
        case "log":
          addLog(event.level, event.text, currentStep.current);
          break;
        case "step":
          currentStep.current = event.step;
          setSteps((current) => ({
            ...current,
            [event.step]: {
              status:
                event.status === "start" ? "running" : event.status === "done" ? "done" : "failed",
              ...(event.note ? { note: event.note } : {}),
            },
          }));
          break;
        case "quota":
          setQuota(event.rateLimit);
          break;
        case "gaps": {
          setGaps(event.gaps);
          if (event.totals) setScanTotals(event.totals);
          if (event.overview) setOverview(event.overview);
          if (event.coverageStatus !== undefined) setCoverageStatus(event.coverageStatus);
          if (event.coverageReason !== undefined) setCoverageReason(event.coverageReason);
          break;
        }
        case "generation": {
          const path = event.generation.sourcePath;
          setLive((current) => ({ ...current, [path]: { generation: event.generation } }));
          setPullUrls((current) => {
            if (!(path in current)) return current;
            const next = { ...current };
            delete next[path];
            return next;
          });
          break;
        }
        case "validation": {
          const path = event.sourcePath;
          if (path) {
            setLive((current) => ({
              ...current,
              [path]: { ...current[path], validation: event.validation },
            }));
          }
          if (path) {
          }
          break;
        }
        case "api":
          if (event.retest) setWasRetest(true);
          setApiResults((current) => {
            const next = [...current];
            for (const result of event.results) {
              const index = next.findIndex(
                (item) =>
                  item.specPath === result.specPath &&
                  item.method === result.method &&
                  item.path === result.path,
              );
              if (index === -1) next.push(result);
              else next[index] = result;
            }
            return next;
          });
          break;
        case "result": {
          if (event.generation) {
            const path = event.generation.sourcePath;
            setLive((current) => ({ ...current, [path]: { generation: event.generation } }));
          }
          // A run covers every gap it could: the first ready test is the one
          // that opens in the preview.
          if (event.ready?.length) {
          }
          if (event.ok) {
            // The run stops at the pull request stage: the preview opens here
            // and the reviewer opens the PR by hand.
            showToast({
              title: event.ready?.length ? `${event.ready.length} test(s) ready` : "Test ready",
              description: "Review the preview, then open the pull request.",
              variant: "success",
            });
          } else {
            const reason = event.reason?.split("\n")[0] ?? "Validation did not pass.";
            if (isProviderError(reason)) setProviderError(reason);
            showToast({
              title: isProviderError(reason)
                ? providerErrorTitle(reason)
                : "Run finished without a ready test",
              description: reason,
              variant: "warning",
            });
          }
          break;
        }
        case "error":
          // A manual stop aborts the stream; don't report it as a failure.
          if (isAbortError(event.message)) break;
          // The matching log event is already emitted by the pipeline.
          if (isProviderError(event.message)) setProviderError(event.message);
          showToast({
            title: isProviderError(event.message)
              ? providerErrorTitle(event.message)
              : "Run failed",
            description: event.message,
            variant: "warning",
          });
          break;
      }
    },
    [addLog, project.folder, showToast],
  );

  const run = async (options: { retestOperations?: RetestOperation[] } = {}) => {
    const active = getProject();
    const retesting = Boolean(options.retestOperations?.length);
    if (running) return;
    if (active.localPath) {
      showToast({
        title: "Local project",
        description:
          "The pipeline opens a pull request, so it needs GitHub. Use Scan and Missing tests here.",
        variant: "warning",
      });
      return;
    }
    if (!active.repo) {
      showToast({
        title: "Repository required",
        description: "Enter owner/name or a local folder path in the header.",
        variant: "warning",
      });
      return;
    }

    setRunning(true);
    setSteps(INITIAL_STEPS);
    setApiResults([]);
    setLogs([]);
    setLive({});
    setApiResults([]);
    setWasRetest(retesting);
    setRunId(undefined);
    const controller = new AbortController();
    abortRef.current = controller;
    currentStep.current = "scan";
    addLog(
      "info",
      retesting
        ? `Retesting ${options.retestOperations?.length ?? 0} failed endpoint(s) for ${active.repo}@${active.ref || "main"}.`
        : `EdgeSpec starting for ${active.repo}@${active.ref || "main"}.`,
      "scan",
    );

    try {
      await runPipelineStream(
        active,
        getSettings(),
        handleEvent,
        controller.signal,
        undefined,
        options.retestOperations,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isAbortError(message)) {
        addLog("info", "Run stopped.", currentStep.current);
      } else {
        addLog("error", message, currentStep.current);
        showToast({ title: "Run failed", description: message, variant: "warning" });
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
      currentStep.current = undefined;
      setSteps((current) => {
        const next = { ...current };
        for (const key of Object.keys(next) as Array<keyof Steps>) {
          if (next[key].status === "running") {
            next[key] = { status: "failed", note: "stopped" };
          }
        }
        return next;
      });
    }
  };

  /** Retests only the failed contract operations; the scan and unit work stay put. */
  const retest = (operations: RetestOperation[]) => {
    if (operations.length > 0) void run({ retestOperations: operations });
  };

  const stop = () => {
    abortRef.current?.abort();
    addLog("warn", "Run stopped by the user.", currentStep.current);
  };

  const scan = async () => {
    const active = getProject();
    if (scanning) return;
    if (!active.repo && !active.localPath) {
      showToast({
        title: "Project required",
        description: "Enter owner/name or a local folder path in the header.",
        variant: "warning",
      });
      return;
    }
    setScanning(true);
    setSteps({ ...INITIAL_STEPS, scan: { status: "running" } });
    // The scan fills the Overview; the reader stays where they are.
    try {
      const result = await scanRepo(active);
      setGaps([
        ...result.gaps,
        ...(result.coverageGaps ?? []),
        ...(result.apiGaps ?? []),
        ...(result.unsupported ?? []),
      ]);
      setSteps({
        ...INITIAL_STEPS,
        scan: {
          status: "done",
          note: `${result.gaps.length + (result.apiGaps?.length ?? 0) + (result.coverageGaps?.length ?? 0)} gaps`,
        },
      });
      if (result.totals) setScanTotals(result.totals);
      if (result.truncated) setScanTruncated(result.truncated);
      setCoverageStatus(result.coverageStatus ?? "not-run");
      setCoverageReason(result.coverageReason);
      if (result.overview) setOverview(result.overview);
      addGapLog(
        "success",
        `Scanned ${result.scanned} paths: ${result.gaps.length} untested file(s).`,
      );
      showToast({
        title: `${result.gaps.length} untested file(s) found`,
        description: `${result.scanned} paths scanned.`,
        variant: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSteps({ ...INITIAL_STEPS, scan: { status: "failed", note: "scan failed" } });
      addGapLog("error", message);
      showToast({ title: "Scan failed", description: message, variant: "warning" });
    } finally {
      setScanning(false);
    }
  };

  /** Opens one pull request from the review queue with editable copy. */
  const openPullForItems = async (items: GeneratedTest[], meta: PullMeta): Promise<string> => {
    const active = getProject();
    if (active.localPath) {
      throw new Error("Pull requests need a GitHub repository.");
    }
    const activeSettings = getSettings();
    const result = await openPullWithFiles(
      active,
      activeSettings,
      items.map((item) => ({
        sourcePath: item.generation.sourcePath,
        path: item.generation.testPath,
        code: item.generation.code,
        provider: item.generation.provider,
        model: item.generation.model,
        corrected: item.generation.corrected,
        verified: item.validation.verified,
        ...(item.validation.checks ? { checks: item.validation.checks } : {}),
        ...(item.validation.coverage ? { coverage: item.validation.coverage } : {}),
      })),
      { ...meta, ...(runId ? { runId } : {}) },
      apiResults
        .filter((result) => result.status === "skipped")
        .map((result) => ({
          method: result.method,
          path: result.path,
          reason: result.error ?? "skipped",
        })),
      activeSettings.policy,
    );
    setPullUrls((current) => {
      const next = { ...current };
      for (const item of items) next[item.generation.sourcePath] = result.url;
      return next;
    });
    addGapLog("success", `Pull request opened with ${result.files} test file(s): ${result.url}`);
    showToast({
      title: `Pull request opened with ${result.files} test(s)`,
      description: result.url,
      variant: "success",
    });
    return result.url;
  };

  /** The logo clears the workspace: repository, scan, tests and run. */
  const resetAll = () => {
    setProject({ repo: "", ref: "", folder: "", localPath: "" });
    setGaps([]);
    setOverview(undefined);
    setGenerated([]);
    setLive({});
    setPullUrls({});
    setRunId(undefined);
    setWasRetest(false);
    setLogs([]);
    setGapLogs([]);
    setSteps(INITIAL_STEPS);
    showToast({
      title: "Everything was reset",
      description: "The repository, the scan and the generated tests are gone.",
      variant: "success",
    });
  };

  /** Opens Settings, optionally at one of its sections. */
  const openSettings = (section?: SettingsSection) => {
    setSettingsSection(section);
    setSettingsOpen(true);
  };

  /** One generation. The caller decides whether these run in parallel. */
  const generateOne = async (
    path: string,
    signal?: AbortSignal,
    previous?: { code: string; output: string },
  ): Promise<boolean> => {
    const evidence = gaps.find((gap) => gap.path === path)?.evidence;
    const targeting =
      evidence && (evidence.uncoveredLines?.length || evidence.uncoveredBranches?.length)
        ? {
            ...(evidence.uncoveredLines?.length ? { uncoveredLines: evidence.uncoveredLines } : {}),
            ...(evidence.uncoveredBranches?.length
              ? { uncoveredBranches: evidence.uncoveredBranches }
              : {}),
          }
        : undefined;
    try {
      const result = await regenerate(
        getProject(),
        getSettings(),
        path,
        signal,
        previous,
        targeting,
      );
      if (result.rateLimit) setQuota(result.rateLimit);
      for (const notice of result.notices ?? []) addGapLog("warn", notice);
      setProviderError(undefined);
      setLive((current) => ({
        ...current,
        [path]: { generation: result.generation, validation: result.validation },
      }));
      setPullUrls((current) => {
        if (!(path in current)) return current;
        const next = { ...current };
        delete next[path];
        return next;
      });
      setGenerated((current) => {
        const index = current.findIndex((item) => item.generation.sourcePath === path);
        const next = { generation: result.generation, validation: result.validation };
        if (index === -1) return [...current, next];
        const copy = current.slice();
        copy[index] = next;
        return copy;
      });
      const passes = result.attempts ? ` · ${result.attempts} self-correct pass(es)` : "";
      addGapLog(
        "info",
        `${previous ? "Rewrote" : "Generated"} ${result.generation.code.split("\n").length} lines for ${path}${passes}.`,
      );
      if (result.validation.ok) {
        addGapLog("success", `${path}: validation passed${passes}.`);
      } else {
        addGapLog(
          "error",
          `${path}: validation failed${passes} — ${failureSummary(result.validation.output)}`,
        );
      }
      return result.validation.ok;
    } catch (error) {
      // A cancelled run is not a failure.
      const message = error instanceof Error ? error.message : String(error);
      if ((error instanceof DOMException && error.name === "AbortError") || isAbortError(message))
        return false;
      if (isProviderError(message)) setProviderError(message);
      addGapLog("error", message);
      showToast({
        title: providerErrorTitle(message),
        description: message,
        variant: "warning",
      });
      return false;
    }
  };

  /**
   * Generates tests for the given paths. Settings decide whether they run
   * side by side or one after the other. Parallel mode accepts a new batch
   * while one is still running, so the reader can queue more files.
   */
  const generatePaths = async (paths: string[]) => {
    if (paths.length === 0) return;
    if (activeBatches.current > 0 && !settings.parallelGeneration) return;
    const controller = generationAbortRef.current ?? new AbortController();
    generationAbortRef.current = controller;
    activeBatches.current += 1;
    setGenerating(true);
    setGeneratingPaths((current) => [...new Set([...current, ...paths])]);
    if (activeBatches.current === 1) {
      setLive({});
    }
    addGapLog(
      "ai",
      settings.parallelGeneration
        ? `Generating ${paths.length} test(s) in parallel.`
        : `Generating ${paths.length} test(s).`,
    );
    try {
      const results = settings.parallelGeneration
        ? await Promise.all(paths.map((path) => generateOne(path, controller.signal)))
        : await paths.reduce<Promise<boolean[]>>(async (carry, path) => {
            const done = await carry;
            return [...done, await generateOne(path, controller.signal)];
          }, Promise.resolve([]));
      const failed = results.filter((ok) => !ok).length;
      // Only a run where every test arrived may say the tests are ready.
      if (failed === 0) {
        showToast({
          title: `${paths.length} test(s) ready`,
          description: "Review the preview, then open the pull request.",
          variant: "success",
        });
      } else {
        showToast({
          title: `${failed} of ${paths.length} test(s) failed`,
          description: "The reason is on the file and in the preview.",
          variant: "warning",
        });
      }
    } finally {
      activeBatches.current = Math.max(0, activeBatches.current - 1);
      setGeneratingPaths((current) => current.filter((path) => !paths.includes(path)));
      if (activeBatches.current === 0) {
        generationAbortRef.current = null;
        setGenerating(false);
      }
    }
  };

  /** Stops every running generation. */
  const stopGenerating = () => {
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    activeBatches.current = 0;
    setGenerating(false);
    setGeneratingPaths([]);
    addGapLog("warn", "Generation stopped.");
  };

  return (
    <>
      <AgentWorkspace
        project={project}
        settings={settings}
        {...(quota ? { quota } : {})}
        {...(providerError ? { providerError } : {})}
        running={running}
        scanning={scanning}
        generating={generating}
        generatingPaths={generatingPaths}
        steps={steps}
        logs={logs}
        gapLogs={gapLogs}
        gaps={gaps}
        {...(scanTotals ? { totals: scanTotals } : {})}
        {...(scanTruncated ? { truncated: scanTruncated } : {})}
        {...(coverageStatus ? { coverageStatus } : {})}
        {...(coverageReason ? { coverageReason } : {})}
        {...(overview ? { overview } : {})}
        generated={generated}
        pullUrls={pullUrls}
        {...(runId ? { runId } : {})}
        apiResults={apiResults}
        {...(wasRetest ? { retest: true } : {})}
        {...(toast ? { toast } : {})}
        onRun={run}
        onScan={scan}
        onRetest={retest}
        onStop={stop}
        onStopGenerating={stopGenerating}
        onReset={resetAll}
        onGenerate={generatePaths}
        onOpenPull={openPullForItems}
        onOpenSettings={openSettings}
        onDismissToast={() => setToast(undefined)}
      />
      <SettingsSheet
        open={settingsOpen}
        onOpenChange={(next) => {
          setSettingsOpen(next);
          if (!next) setSettingsSection(undefined);
        }}
        {...(settingsSection ? { section: settingsSection } : {})}
      />
    </>
  );
}
