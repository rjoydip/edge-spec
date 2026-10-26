/** Deployment-level settings that live in D1: workspace, audit, schedules, memory, policy. */
import { useEffect, useState, type ReactNode } from "react";
import { CalendarClock, Loader2, Save, Trash2 } from "lucide-react";
import type { RepoMemory } from "@edge-spec/core/memory";
import type { PullPolicy } from "@edge-spec/core/policy";
import {
  Badge,
  Button,
  Dialog,
  Hint,
  Input,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  cn,
} from "@edge-spec/ui";
import {
  deleteMemory,
  deletePolicy,
  deleteSchedule,
  fetchAudit,
  fetchMemory,
  fetchPolicy,
  fetchSchedules,
  fetchWorkspace,
  updateMemory,
  updatePolicy,
  updateSchedule,
  updateWorkspace,
  type AuditEvent,
  type ScheduledRepo,
  type Workspace,
} from "@/api";

const D1_NOTICE =
  "Not enabled on this deployment. Add the optional D1 binding in wrangler.toml and apply the migrations.";

const when = (value: number): string =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const linesOf = (raw: string): string[] =>
  raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const linesText = (values: string[] | undefined): string => (values ?? []).join("\n");

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
        {label}
      </span>
      {children}
      {hint && <span className="block text-[10px] leading-snug text-zinc-500">{hint}</span>}
    </label>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/20 px-3 py-8 text-center text-[11px] text-zinc-500">
      {children}
    </p>
  );
}

function Loading() {
  return (
    <p className="flex items-center justify-center gap-2 py-8 text-[11px] text-zinc-500">
      <Loader2 className="size-3.5 animate-spin" /> Loading…
    </p>
  );
}

function RepoRequired() {
  return <Notice>Select a repository first; this setting is stored per repository.</Notice>;
}

function WorkspacePanel({ open }: { open: boolean }) {
  const [workspace, setWorkspace] = useState<Workspace>();
  const [enabled, setEnabled] = useState(true);
  const [name, setName] = useState("");
  const [retentionDays, setRetentionDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetchWorkspace()
      .then((result) => {
        if (cancelled) return;
        setEnabled(result.enabled);
        if (result.workspace) {
          setWorkspace(result.workspace);
          setName(result.workspace.name);
          setRetentionDays(result.workspace.retentionDays);
        }
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
  }, [open]);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      const result = await updateWorkspace({ name, retentionDays });
      setWorkspace(result.workspace);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (!enabled) return <Notice>{D1_NOTICE}</Notice>;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Workspace name" hint="Trimmed to 100 characters.">
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field
          label="Retention (days)"
          hint="Runs, audit events and rate-limit rows expire after this."
        >
          <Input
            type="number"
            min={1}
            max={365}
            value={retentionDays}
            onChange={(event) => setRetentionDays(Number(event.target.value))}
          />
        </Field>
      </div>
      <p className="text-[10px] text-zinc-500">
        One workspace per deployment. Created{" "}
        {workspace ? when(workspace.createdAt) : "on the first read"}.
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save workspace
        </Button>
        {saved && <span className="text-[11px] text-emerald-300">Saved.</span>}
      </div>
      {error && <p className="text-[11px] text-rose-300">{error}</p>}
    </div>
  );
}

function AuditPanel({ open, repo }: { open: boolean; repo: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [scope, setScope] = useState<"repo" | "all">(repo ? "repo" : "all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetchAudit(scope === "repo" && repo ? repo : undefined)
      .then((result) => {
        if (cancelled) return;
        setEnabled(result.enabled);
        setEvents(result.events);
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
  }, [open, repo, scope]);

  if (loading) return <Loading />;
  if (!enabled) return <Notice>{D1_NOTICE}</Notice>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant={scope === "repo" ? "default" : "outline"}
          disabled={!repo}
          onClick={() => setScope("repo")}
        >
          This repository
        </Button>
        <Button
          size="sm"
          variant={scope === "all" ? "default" : "outline"}
          onClick={() => setScope("all")}
        >
          Every repository
        </Button>
        <span className="ml-auto text-[10px] text-zinc-500">{events.length} events</span>
      </div>
      {events.length === 0 ? (
        <Notice>
          No audit events yet. Updates to workspace, memory, policy and schedules write here.
        </Notice>
      ) : (
        <div className="space-y-1.5">
          {events.map((event, index) => (
            <div
              key={event.id ?? `${event.createdAt}-${index}`}
              className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral">{event.action}</Badge>
                {event.repo && (
                  <span className="font-mono text-[10px] text-zinc-400">{event.repo}</span>
                )}
                <span className="text-[10px] text-zinc-500">{event.actor}</span>
                <span className="ml-auto text-[10px] text-zinc-500">{when(event.createdAt)}</span>
              </div>
              {Object.keys(event.detail).length > 0 && (
                <code className="mt-1 block truncate font-mono text-[10px] text-zinc-500">
                  {JSON.stringify(event.detail)}
                </code>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-zinc-500">
        Structural detail only; token, key, secret, password, authorization and cookie fields are
        dropped before storage.
      </p>
      {error && <p className="text-[11px] text-rose-300">{error}</p>}
    </div>
  );
}

function SchedulesPanel({ open, repo }: { open: boolean; repo: string }) {
  const [schedules, setSchedules] = useState<ScheduledRepo[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [intervalDays, setIntervalDays] = useState(7);
  const [scheduleOn, setScheduleOn] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetchSchedules()
      .then((result) => {
        if (cancelled) return;
        setEnabled(result.enabled);
        setSchedules(result.schedules);
        const mine = result.schedules.find((entry) => entry.repo === repo);
        if (mine) {
          setIntervalDays(mine.intervalDays);
          setScheduleOn(mine.enabled);
        }
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

  const save = async () => {
    if (!repo) return;
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      const result = await updateSchedule({
        repo,
        intervalDays,
        enabled: scheduleOn,
      });
      setSchedules(result.schedules);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (target: string) => {
    if (!window.confirm(`Remove the scheduled drift scan for ${target}?`)) return;
    setBusy(true);
    setError(undefined);
    try {
      await deleteSchedule(target);
      setSchedules((current) => current.filter((entry) => entry.repo !== target));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (!enabled) return <Notice>{D1_NOTICE}</Notice>;

  return (
    <div className="space-y-3">
      {repo ? (
        <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-3 py-2.5">
          <div className="mb-2 flex items-center gap-2">
            <CalendarClock className="size-3.5 text-sky-300" />
            <span className="font-mono text-[11px] text-zinc-300">{repo}</span>
            <Switch
              size="sm"
              className="ml-auto"
              checked={scheduleOn}
              onCheckedChange={setScheduleOn}
              aria-label="Enable the scheduled drift scan"
            />
          </div>
          <div className="flex items-end gap-2">
            <Field label="Every (days)" hint="1–30. Due scans run on the daily cron.">
              <Input
                type="number"
                min={1}
                max={30}
                value={intervalDays}
                onChange={(event) => setIntervalDays(Number(event.target.value))}
              />
            </Field>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Save schedule
            </Button>
          </div>
          <p className="mt-2 text-[10px] text-zinc-500">
            The scan keeps a snapshot of untested paths and operations. It posts one summary when
            something changed and never opens a pull request.
          </p>
          {saved && <p className="mt-1 text-[11px] text-emerald-300">Saved.</p>}
        </div>
      ) : (
        <RepoRequired />
      )}
      <div>
        <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
          Scheduled repositories
        </p>
        {schedules.length === 0 ? (
          <Notice>No repository is scheduled.</Notice>
        ) : (
          <div className="space-y-1.5">
            {schedules.map((entry) => (
              <div
                key={entry.repo}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2",
                  entry.repo === repo
                    ? "border-indigo-500/40 bg-indigo-500/10"
                    : "border-zinc-800/70 bg-zinc-900/40",
                )}
              >
                <span className="font-mono text-[11px] text-zinc-300">{entry.repo}</span>
                <Badge variant={entry.enabled ? "success" : "neutral"}>
                  {entry.enabled ? "enabled" : "paused"}
                </Badge>
                <span className="text-[10px] text-zinc-500">every {entry.intervalDays}d</span>
                <span className="text-[10px] text-zinc-500">
                  {entry.lastRunAt ? `last ${when(entry.lastRunAt)}` : "never run"}
                </span>
                <Hint label="Remove this schedule">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="ml-auto"
                    aria-label={`Remove schedule for ${entry.repo}`}
                    onClick={() => remove(entry.repo)}
                    disabled={busy}
                  >
                    <Trash2 className="size-3.5 text-rose-300" />
                  </Button>
                </Hint>
              </div>
            ))}
          </div>
        )}
      </div>
      {error && <p className="text-[11px] text-rose-300">{error}</p>}
    </div>
  );
}

function MemoryPanel({ open, repo }: { open: boolean; repo: string }) {
  const [enabled, setEnabled] = useState(true);
  const [naming, setNaming] = useState("");
  const [conventions, setConventions] = useState("");
  const [helpers, setHelpers] = useState("");
  const [fixtures, setFixtures] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open || !repo) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetchMemory(repo)
      .then((result) => {
        if (cancelled) return;
        setEnabled(result.enabled);
        setNaming(result.memory.naming ?? "");
        setConventions(linesText(result.memory.conventions));
        setHelpers(linesText(result.memory.helpers));
        setFixtures(linesText(result.memory.fixtures));
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

  const memoryOf = (): RepoMemory => ({
    ...(naming.trim() ? { naming: naming.trim() } : {}),
    ...(linesOf(conventions).length > 0 ? { conventions: linesOf(conventions) } : {}),
    ...(linesOf(helpers).length > 0 ? { helpers: linesOf(helpers) } : {}),
    ...(linesOf(fixtures).length > 0 ? { fixtures: linesOf(fixtures) } : {}),
  });

  const save = async () => {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      const result = await updateMemory(repo, memoryOf());
      setNaming(result.memory.naming ?? "");
      setConventions(linesText(result.memory.conventions));
      setHelpers(linesText(result.memory.helpers));
      setFixtures(linesText(result.memory.fixtures));
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!window.confirm(`Delete the stored memory for ${repo}?`)) return;
    setBusy(true);
    setError(undefined);
    try {
      await deleteMemory(repo);
      setNaming("");
      setConventions("");
      setHelpers("");
      setFixtures("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (!repo) return <RepoRequired />;
  if (loading) return <Loading />;
  if (!enabled) return <Notice>{D1_NOTICE}</Notice>;

  return (
    <div className="space-y-3">
      <Field label="Naming convention" hint="Short, approved; never source code.">
        <Input value={naming} onChange={(event) => setNaming(event.target.value)} />
      </Field>
      <Field label="Conventions" hint="One per line. The model is told to follow these.">
        <Textarea
          rows={3}
          value={conventions}
          onChange={(event) => setConventions(event.target.value)}
        />
      </Field>
      <Field label="Existing helpers" hint="One per line. Imports the model may reuse.">
        <Textarea rows={3} value={helpers} onChange={(event) => setHelpers(event.target.value)} />
      </Field>
      <Field label="Existing fixtures" hint="One per line. Fixture paths or names already present.">
        <Textarea rows={2} value={fixtures} onChange={(event) => setFixtures(event.target.value)} />
      </Field>
      <p className="text-[10px] text-zinc-500">
        Memory is injected into every run and webhook generation. It changes the generated tests, so
        only keep conventions a human has approved.
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save memory
        </Button>
        <Hint label="Delete stored memory">
          <Button
            size="icon"
            variant="outline"
            onClick={clear}
            disabled={busy}
            aria-label="Delete stored memory"
          >
            <Trash2 className="size-3.5 text-rose-300" />
          </Button>
        </Hint>
        {saved && <span className="text-[11px] text-emerald-300">Saved.</span>}
      </div>
      {error && <p className="text-[11px] text-rose-300">{error}</p>}
    </div>
  );
}

function PolicyPanel({ open, repo }: { open: boolean; repo: string }) {
  const [enabled, setEnabled] = useState(true);
  const [killSwitch, setKillSwitch] = useState(false);
  const [draftOnly, setDraftOnly] = useState(false);
  const [maxFiles, setMaxFiles] = useState(0);
  const [minCoverageDelta, setMinCoverageDelta] = useState(0);
  const [allowedPaths, setAllowedPaths] = useState("");
  const [labels, setLabels] = useState("");
  const [reviewers, setReviewers] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const fill = (policy: PullPolicy) => {
    setKillSwitch(policy.killSwitch === true);
    setDraftOnly(policy.draftOnly === true);
    setMaxFiles(policy.maxFiles ?? 0);
    setMinCoverageDelta(policy.minCoverageDelta ?? 0);
    setAllowedPaths(linesText(policy.allowedPaths));
    setLabels(linesText(policy.labels));
    setReviewers(linesText(policy.reviewers));
  };

  useEffect(() => {
    if (!open || !repo) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetchPolicy(repo)
      .then((result) => {
        if (cancelled) return;
        setEnabled(result.enabled);
        fill(result.policy);
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

  const policyOf = (): PullPolicy => ({
    ...(killSwitch ? { killSwitch: true } : {}),
    ...(draftOnly ? { draftOnly: true } : {}),
    ...(maxFiles > 0 ? { maxFiles } : {}),
    ...(minCoverageDelta > 0 ? { minCoverageDelta } : {}),
    ...(linesOf(allowedPaths).length > 0 ? { allowedPaths: linesOf(allowedPaths) } : {}),
    ...(linesOf(labels).length > 0 ? { labels: linesOf(labels) } : {}),
    ...(linesOf(reviewers).length > 0 ? { reviewers: linesOf(reviewers) } : {}),
  });

  const save = async () => {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      const result = await updatePolicy(repo, policyOf());
      fill(result.policy);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!window.confirm(`Delete the stored pull request policy for ${repo}?`)) return;
    setBusy(true);
    setError(undefined);
    try {
      await deletePolicy(repo);
      fill({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (!repo) return <RepoRequired />;
  if (loading) return <Loading />;
  if (!enabled) return <Notice>{D1_NOTICE}</Notice>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-[11px] text-zinc-300">
          <Switch checked={killSwitch} onCheckedChange={setKillSwitch} size="sm" />
          Kill switch (block every pull request)
        </label>
        <label className="flex items-center gap-2 text-[11px] text-zinc-300">
          <Switch checked={draftOnly} onCheckedChange={setDraftOnly} size="sm" />
          Draft only
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Max files" hint="0 disables the gate. Clamped to 1–100 when set.">
          <Input
            type="number"
            min={0}
            max={100}
            value={maxFiles}
            onChange={(event) => setMaxFiles(Number(event.target.value))}
          />
        </Field>
        <Field label="Min coverage delta" hint="0 disables the gate.">
          <Input
            type="number"
            min={0}
            value={minCoverageDelta}
            onChange={(event) => setMinCoverageDelta(Number(event.target.value))}
          />
        </Field>
      </div>
      <Field label="Extra allowed paths" hint="One glob per line, beyond the test-only policy.">
        <Textarea
          rows={2}
          value={allowedPaths}
          onChange={(event) => setAllowedPaths(event.target.value)}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Labels" hint="One per line, applied after the pull request opens.">
          <Textarea rows={2} value={labels} onChange={(event) => setLabels(event.target.value)} />
        </Field>
        <Field label="Reviewers" hint="One GitHub login per line.">
          <Textarea
            rows={2}
            value={reviewers}
            onChange={(event) => setReviewers(event.target.value)}
          />
        </Field>
      </div>
      <p className="text-[10px] text-zinc-500">
        This policy gates webhook-driven pull requests. It is stored in D1, not in this browser.
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save policy
        </Button>
        <Hint label="Delete stored policy">
          <Button
            size="icon"
            variant="outline"
            onClick={clear}
            disabled={busy}
            aria-label="Delete stored policy"
          >
            <Trash2 className="size-3.5 text-rose-300" />
          </Button>
        </Hint>
        {saved && <span className="text-[11px] text-emerald-300">Saved.</span>}
      </div>
      {error && <p className="text-[11px] text-rose-300">{error}</p>}
    </div>
  );
}

/** One dialog for the D1/R2 configuration the header used to hide behind raw HTTP. */
export function DeploymentDialog({
  open,
  onClose,
  repo,
}: {
  open: boolean;
  onClose: () => void;
  repo: string;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Deployment"
      description="Stored in this deployment's D1 and R2 — never in this browser."
      className="max-w-3xl"
    >
      <Tabs defaultValue="workspace">
        <TabsList className="-mx-4 -mt-3 mb-3 flex-wrap border-b border-zinc-800 px-4 pt-3 pb-2">
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="schedules">Schedules</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
          <TabsTrigger value="policies">Policies</TabsTrigger>
        </TabsList>
        <TabsContent
          value="workspace"
          forceMount
          className="h-[min(26rem,55vh)] overflow-y-auto pr-1"
          style={{ animation: "none" }}
        >
          <WorkspacePanel open={open} />
        </TabsContent>
        <TabsContent
          value="audit"
          forceMount
          className="h-[min(26rem,55vh)] overflow-y-auto pr-1"
          style={{ animation: "none" }}
        >
          <AuditPanel open={open} repo={repo} />
        </TabsContent>
        <TabsContent
          value="schedules"
          forceMount
          className="h-[min(26rem,55vh)] overflow-y-auto pr-1"
          style={{ animation: "none" }}
        >
          <SchedulesPanel open={open} repo={repo} />
        </TabsContent>
        <TabsContent
          value="memory"
          forceMount
          className="h-[min(26rem,55vh)] overflow-y-auto pr-1"
          style={{ animation: "none" }}
        >
          <MemoryPanel open={open} repo={repo} />
        </TabsContent>
        <TabsContent
          value="policies"
          forceMount
          className="h-[min(26rem,55vh)] overflow-y-auto pr-1"
          style={{ animation: "none" }}
        >
          <PolicyPanel open={open} repo={repo} />
        </TabsContent>
      </Tabs>
    </Dialog>
  );
}
