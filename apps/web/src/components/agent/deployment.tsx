/**
 * Deployment configuration (D1/R2) shown inside Settings, plus the audit log.
 * These are saved to the server, unlike the browser-bound settings around them.
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  CalendarClock,
  Database,
  Loader2,
  MemoryStick,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { RepoMemory } from "@edge-spec/core/memory";
import type { PullPolicy } from "@edge-spec/core/policy";
import { Badge, Button, Dialog, Hint, Input, Switch, Textarea, cn } from "@edge-spec/ui";
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

function SubHead({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof Database;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-3.5 shrink-0 text-zinc-500" />
      <span className="text-[10px] font-semibold tracking-wide text-zinc-200 uppercase">
        {title}
      </span>
      {hint && <span className="ml-auto truncate font-mono text-[9px] text-zinc-500">{hint}</span>}
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-zinc-800/70" />;
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/20 px-2.5 py-3 text-center text-[10px] text-zinc-500">
      {children}
    </p>
  );
}

function Loading() {
  return (
    <p className="flex items-center justify-center gap-2 py-4 text-[10px] text-zinc-500">
      <Loader2 className="size-3 animate-spin" /> Loading…
    </p>
  );
}

function SaveState({ saved }: { saved: boolean }) {
  return saved ? <span className="text-[10px] text-emerald-300">Saved.</span> : null;
}

function WorkspaceBlock() {
  const [enabled, setEnabled] = useState(true);
  const [name, setName] = useState("");
  const [retentionDays, setRetentionDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchWorkspace()
      .then((result) => {
        if (cancelled) return;
        setEnabled(result.enabled);
        if (result.workspace) {
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
  }, []);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await updateWorkspace({ name, retentionDays });
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
    <div className="space-y-2.5">
      <SubHead icon={Database} title="Workspace" hint="deployment-wide" />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name" hint="Trimmed to 100 characters.">
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Retention (days)" hint="Runs, audit and rate limits.">
          <Input
            type="number"
            min={1}
            max={365}
            value={retentionDays}
            onChange={(event) => setRetentionDays(Number(event.target.value))}
          />
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save
        </Button>
        <SaveState saved={saved} />
      </div>
      {error && <p className="text-[10px] text-rose-300">{error}</p>}
    </div>
  );
}

function MemoryBlock({ repo }: { repo: string }) {
  const [enabled, setEnabled] = useState(true);
  const [naming, setNaming] = useState("");
  const [conventions, setConventions] = useState("");
  const [helpers, setHelpers] = useState("");
  const [fixtures, setFixtures] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
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
  }, [repo]);

  const fill = (memory: RepoMemory) => {
    setNaming(memory.naming ?? "");
    setConventions(linesText(memory.conventions));
    setHelpers(linesText(memory.helpers));
    setFixtures(linesText(memory.fixtures));
  };

  const save = async () => {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      const result = await updateMemory(repo, {
        ...(naming.trim() ? { naming: naming.trim() } : {}),
        ...(linesOf(conventions).length > 0 ? { conventions: linesOf(conventions) } : {}),
        ...(linesOf(helpers).length > 0 ? { helpers: linesOf(helpers) } : {}),
        ...(linesOf(fixtures).length > 0 ? { fixtures: linesOf(fixtures) } : {}),
      });
      fill(result.memory);
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
      fill({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (!enabled) return <Notice>{D1_NOTICE}</Notice>;

  return (
    <div className="space-y-2.5">
      <SubHead icon={MemoryStick} title="Repository memory" hint={repo} />
      <Field label="Naming" hint="Short and approved; never source code.">
        <Input value={naming} onChange={(event) => setNaming(event.target.value)} />
      </Field>
      <Field label="Conventions" hint="One per line. Injected into every generation.">
        <Textarea
          rows={2}
          value={conventions}
          onChange={(event) => setConventions(event.target.value)}
        />
      </Field>
      <Field label="Existing helpers" hint="One per line; imports the model may reuse.">
        <Textarea rows={2} value={helpers} onChange={(event) => setHelpers(event.target.value)} />
      </Field>
      <Field label="Existing fixtures" hint="One per line; paths or names already present.">
        <Textarea rows={2} value={fixtures} onChange={(event) => setFixtures(event.target.value)} />
      </Field>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save
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
        <SaveState saved={saved} />
      </div>
      {error && <p className="text-[10px] text-rose-300">{error}</p>}
    </div>
  );
}

function PolicyBlock({ repo }: { repo: string }) {
  const [enabled, setEnabled] = useState(true);
  const [killSwitch, setKillSwitch] = useState(false);
  const [draftOnly, setDraftOnly] = useState(false);
  const [maxFiles, setMaxFiles] = useState(0);
  const [minCoverageDelta, setMinCoverageDelta] = useState(0);
  const [allowedPaths, setAllowedPaths] = useState("");
  const [labels, setLabels] = useState("");
  const [reviewers, setReviewers] = useState("");
  const [loading, setLoading] = useState(true);
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
    let cancelled = false;
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
  }, [repo]);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      const result = await updatePolicy(repo, {
        ...(killSwitch ? { killSwitch: true } : {}),
        ...(draftOnly ? { draftOnly: true } : {}),
        ...(maxFiles > 0 ? { maxFiles } : {}),
        ...(minCoverageDelta > 0 ? { minCoverageDelta } : {}),
        ...(linesOf(allowedPaths).length > 0 ? { allowedPaths: linesOf(allowedPaths) } : {}),
        ...(linesOf(labels).length > 0 ? { labels: linesOf(labels) } : {}),
        ...(linesOf(reviewers).length > 0 ? { reviewers: linesOf(reviewers) } : {}),
      });
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

  if (loading) return <Loading />;
  if (!enabled) return <Notice>{D1_NOTICE}</Notice>;

  return (
    <div className="space-y-2.5">
      <SubHead icon={ShieldCheck} title="Pull request policy" hint={repo} />
      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-2 text-[10px] text-zinc-300">
          <Switch checked={killSwitch} onCheckedChange={setKillSwitch} size="sm" />
          Kill switch
        </label>
        <label className="flex items-center gap-2 text-[10px] text-zinc-300">
          <Switch checked={draftOnly} onCheckedChange={setDraftOnly} size="sm" />
          Draft only
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Max files" hint="0 = no gate.">
          <Input
            type="number"
            min={0}
            max={100}
            value={maxFiles}
            onChange={(event) => setMaxFiles(Number(event.target.value))}
          />
        </Field>
        <Field label="Coverage delta" hint="0 = no gate.">
          <Input
            type="number"
            min={0}
            value={minCoverageDelta}
            onChange={(event) => setMinCoverageDelta(Number(event.target.value))}
          />
        </Field>
      </div>
      <Field label="Extra allowed paths" hint="One glob per line.">
        <Textarea
          rows={2}
          value={allowedPaths}
          onChange={(event) => setAllowedPaths(event.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Labels" hint="One per line.">
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
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save
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
        <SaveState saved={saved} />
      </div>
      {error && <p className="text-[10px] text-rose-300">{error}</p>}
    </div>
  );
}

function SchedulesBlock({ repo }: { repo: string }) {
  const [schedules, setSchedules] = useState<ScheduledRepo[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [intervalDays, setIntervalDays] = useState(7);
  const [scheduleOn, setScheduleOn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
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
  }, [repo]);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      const result = await updateSchedule({ repo, intervalDays, enabled: scheduleOn });
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
    <div className="space-y-2.5">
      <SubHead icon={CalendarClock} title="Drift scans" hint={repo} />
      <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-2.5 py-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-zinc-300">{repo}</span>
          <Switch
            size="sm"
            className="ml-auto"
            checked={scheduleOn}
            onCheckedChange={setScheduleOn}
            aria-label="Enable the scheduled drift scan"
          />
        </div>
        <div className="mt-2 flex items-end gap-2">
          <Field label="Every (days)" hint="1–30.">
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
            Save
          </Button>
          <SaveState saved={saved} />
        </div>
        <p className="mt-1.5 text-[10px] leading-snug text-zinc-500">
          The daily cron posts one summary when untested paths or operations change. It never opens
          a pull request.
        </p>
      </div>
      {schedules.length > 0 && (
        <div className="space-y-1">
          {schedules.map((entry) => (
            <div
              key={entry.repo}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-2.5 py-1.5",
                entry.repo === repo
                  ? "border-indigo-500/40 bg-indigo-500/10"
                  : "border-zinc-800/70 bg-zinc-900/40",
              )}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-300">
                {entry.repo}
              </span>
              <Badge variant={entry.enabled ? "success" : "neutral"}>
                {entry.enabled ? "on" : "paused"}
              </Badge>
              <span className="text-[9px] text-zinc-500">{entry.intervalDays}d</span>
              <Hint label="Remove this schedule">
                <Button
                  size="icon"
                  variant="ghost"
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
      {error && <p className="text-[10px] text-rose-300">{error}</p>}
    </div>
  );
}

/** The Settings → Deployment body: server-side configuration only. */
export function DeploymentSettings({ repo }: { repo: string }) {
  return (
    <div className="space-y-3">
      <WorkspaceBlock />
      <Divider />
      {repo ? (
        <>
          <MemoryBlock repo={repo} />
          <Divider />
          <PolicyBlock repo={repo} />
          <Divider />
          <SchedulesBlock repo={repo} />
        </>
      ) : (
        <Notice>Select a repository to edit its memory, policy and drift scan.</Notice>
      )}
    </div>
  );
}

/** Deployment-wide log, opened from the profile menu. */
export function AuditDialog({
  open,
  onClose,
  repo,
}: {
  open: boolean;
  onClose: () => void;
  repo: string;
}) {
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

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Audit log"
      description="Newest first. Token, key, secret, password, authorization and cookie fields are dropped before storage."
      className="max-w-3xl"
    >
      <div className="mb-3 flex items-center gap-1.5">
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
      {!enabled ? (
        <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/20 px-3 py-8 text-center text-[11px] text-zinc-500">
          {D1_NOTICE}
        </p>
      ) : loading ? (
        <p className="flex items-center justify-center gap-2 py-8 text-[11px] text-zinc-500">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </p>
      ) : events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/20 px-3 py-8 text-center text-[11px] text-zinc-500">
          No audit events yet. Workspace, memory, policy and schedule updates write here.
        </p>
      ) : (
        <div className="no-scrollbar max-h-[55vh] space-y-1.5 overflow-y-auto">
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
      {error && <p className="mt-3 text-[11px] text-rose-300">{error}</p>}
    </Dialog>
  );
}
