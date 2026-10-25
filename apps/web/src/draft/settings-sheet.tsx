/** Editable settings for the draft. Every control updates local state only. */
import { useEffect, useState, type ReactNode } from "react";
import {
  Bot,
  Boxes,
  CheckCircle2,
  Gauge,
  KeyRound,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Sun,
  Moon,
} from "lucide-react";
import { PROVIDERS, providerById } from "@edge-spec/core/catalog";
import { SANDBOX_PROVIDERS } from "@edge-spec/core/sandbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Hint,
  Input,
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
  Switch,
  cn,
} from "@edge-spec/ui";
import { ACCENTS, setAccent, toggleMode, useAppearance } from "@/lib/theme";

export interface DraftSettings {
  provider: string;
  model: string;
  accountId: string;
  sandboxProvider: string;
  sandboxUrl: string;
  sandboxConcurrency: number;
  sandboxTimeout: number;
  coverage: boolean;
  githubToken: string;
  aiKey: string;
  sandboxKey: string;
  maxRetries: number;
  maxAiRetries: number;
  maxFiles: number;
  strictTypes: boolean;
}

export type SettingsSection = "provider" | "sandbox" | "keys" | "pipeline" | "appearance";

export const DEFAULT_DRAFT_SETTINGS: DraftSettings = {
  provider: "anthropic",
  model: "claude-sonnet-5-5",
  accountId: "",
  sandboxProvider: "docker",
  sandboxUrl: "http://127.0.0.1:8788",
  sandboxConcurrency: 3,
  sandboxTimeout: 180,
  coverage: true,
  githubToken: "",
  aiKey: "",
  sandboxKey: "",
  maxRetries: 3,
  maxAiRetries: 2,
  maxFiles: 14,
  strictTypes: true,
};

export function SettingsSheet({
  open,
  onOpenChange,
  value,
  onChange,
  section,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: DraftSettings;
  onChange: (next: DraftSettings) => void;
  section?: SettingsSection;
}) {
  const appearance = useAppearance();
  const [health, setHealth] = useState<"idle" | "checking" | "ok">("idle");
  const [openSections, setOpenSections] = useState<string[]>(["provider", "sandbox"]);

  // The header badges open Settings at their own section.
  useEffect(() => {
    if (!open || !section) return;
    setOpenSections((current) => (current.includes(section) ? current : [...current, section]));
    const timer = window.setTimeout(() => {
      document
        .getElementById(`settings-${section}`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [open, section]);
  const update = (patch: Partial<DraftSettings>) => onChange({ ...value, ...patch });
  const provider = providerById(value.provider);
  const needsKey = provider?.needsKey ?? false;

  const checkHealth = () => {
    setHealth("checking");
    window.setTimeout(() => setHealth("ok"), 900);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="max-w-lg">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>
            Editable in this draft. Nothing is stored and no key leaves the page.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-3">
          <Accordion
            type="multiple"
            value={openSections}
            onValueChange={setOpenSections}
            className="space-y-2"
          >
            <Section
              id="provider"
              icon={Bot}
              title="AI provider"
              summary={provider?.name ?? value.provider}
            >
              <Field label="Provider" hint="Controls which protocol and key the run uses.">
                <Select
                  value={value.provider}
                  onValueChange={(next) => {
                    const model = PROVIDERS.find((item) => item.id === next)?.models[0]?.id ?? "";
                    update({ provider: next, model });
                  }}
                >
                  <SelectTrigger aria-label="AI provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Model" hint={provider?.hint ?? "Pick the model that writes the tests."}>
                <Select
                  value={value.model}
                  onValueChange={(model) => update({ model })}
                  disabled={!provider}
                >
                  <SelectTrigger aria-label="AI model">
                    <SelectValue placeholder="Choose a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {(provider?.models ?? []).map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="Cloudflare account ID"
                hint="Only for Workers AI BYOK. Leave blank to use the deployment binding."
              >
                <Input
                  value={value.accountId}
                  onChange={(event) => update({ accountId: event.target.value })}
                  placeholder="32-character account id"
                  className="font-mono"
                />
              </Field>
              <Alert variant={needsKey && !value.aiKey ? "warning" : "success"}>
                {needsKey && !value.aiKey ? <KeyRound /> : <CheckCircle2 />}
                <div>
                  <AlertTitle>
                    {needsKey ? "A key is needed for this provider" : "Ready"}
                  </AlertTitle>
                  <AlertDescription>
                    {needsKey
                      ? "Add it under Keys. It travels as the x-ai-key header; the Worker never stores it."
                      : "Workers AI uses the deployment binding, so no key is required."}
                  </AlertDescription>
                </div>
              </Alert>
            </Section>

            <Section
              id="sandbox"
              icon={Boxes}
              title="Sandbox"
              summary={`${value.sandboxProvider} · ${value.sandboxConcurrency} in flight · ${value.sandboxTimeout}s`}
            >
              <Field
                label="Runner driver"
                hint="Verified runs need a runner. Without one, only static checks run."
              >
                <Select
                  value={value.sandboxProvider}
                  onValueChange={(sandboxProvider) => update({ sandboxProvider })}
                >
                  <SelectTrigger aria-label="Runner driver">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SANDBOX_PROVIDERS.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.label ?? item.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Runner URL" hint="The self-hosted runner, or a hosted driver endpoint.">
                <Input
                  value={value.sandboxUrl}
                  onChange={(event) => update({ sandboxUrl: event.target.value })}
                  placeholder="http://127.0.0.1:8788"
                  className="font-mono"
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Concurrency" hint="Runs in flight, 1–6.">
                  <Input
                    type="number"
                    min={1}
                    max={6}
                    value={value.sandboxConcurrency}
                    onChange={(event) =>
                      update({ sandboxConcurrency: Number(event.target.value) || 1 })
                    }
                  />
                </Field>
                <Field label="Timeout (s)" hint="Per suite.">
                  <Input
                    type="number"
                    min={30}
                    step={30}
                    value={value.sandboxTimeout}
                    onChange={(event) =>
                      update({ sandboxTimeout: Number(event.target.value) || 30 })
                    }
                  />
                </Field>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-3 py-2">
                <span>
                  <span className="block text-[11px] font-medium text-zinc-300">
                    Ask for coverage
                  </span>
                  <span className="block text-[10px] text-zinc-500">
                    LCOV in the run, which turns coverage gaps into measurements.
                  </span>
                </span>
                <Switch
                  checked={value.coverage}
                  onCheckedChange={(coverage) => update({ coverage })}
                  size="sm"
                  aria-label="Ask for coverage"
                />
              </label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={checkHealth}
                  disabled={health === "checking"}
                >
                  {health === "checking" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="size-3.5" />
                  )}
                  Check health
                </Button>
                {health === "ok" && (
                  <Badge variant="success" className="gap-1">
                    <CheckCircle2 className="size-3" />
                    docker 27.1 · namespace · 42ms
                  </Badge>
                )}
                {health === "idle" && (
                  <span className="text-[10px] text-zinc-500">unchecked in this tab</span>
                )}
              </div>
            </Section>

            <Section
              id="keys"
              icon={KeyRound}
              title="Keys"
              summary={
                value.githubToken || value.aiKey || value.sandboxKey
                  ? "set for this tab"
                  : "none set · GitHub token needed for PRs"
              }
            >
              <Field
                label="GitHub token"
                hint="Needed for private repos and opening the pull request."
              >
                <Input
                  type="password"
                  value={value.githubToken}
                  onChange={(event) => update({ githubToken: event.target.value })}
                  placeholder="ghp_…"
                  className="font-mono"
                  autoComplete="off"
                />
              </Field>
              <Field label="AI key" hint={`Used by ${provider?.name ?? "the provider"}.`}>
                <Input
                  type="password"
                  value={value.aiKey}
                  onChange={(event) => update({ aiKey: event.target.value })}
                  placeholder={needsKey ? "sk-…" : "not needed for Workers AI"}
                  className="font-mono"
                  autoComplete="off"
                />
              </Field>
              <Field label="Sandbox key" hint="Optional; only for a protected runner.">
                <Input
                  type="password"
                  value={value.sandboxKey}
                  onChange={(event) => update({ sandboxKey: event.target.value })}
                  placeholder="runner key"
                  className="font-mono"
                  autoComplete="off"
                />
              </Field>
              <Alert variant="info">
                <ShieldCheck />
                <div>
                  <AlertTitle>Headers, never storage</AlertTitle>
                  <AlertDescription>
                    x-github-token, x-ai-key and x-sandbox-key travel per request. The deployment
                    keeps none of them.
                  </AlertDescription>
                </div>
              </Alert>
            </Section>

            <Section
              id="pipeline"
              icon={Gauge}
              title="Pipeline"
              summary={`${value.maxFiles} files · ${value.maxRetries} retries · strict ${value.strictTypes ? "on" : "off"}`}
            >
              <div className="grid grid-cols-2 gap-2">
                <Field label="Max files" hint="Per run.">
                  <Input
                    type="number"
                    min={1}
                    value={value.maxFiles}
                    onChange={(event) => update({ maxFiles: Number(event.target.value) || 1 })}
                  />
                </Field>
                <Field label="Retries" hint="Validation failures.">
                  <Input
                    type="number"
                    min={0}
                    max={6}
                    value={value.maxRetries}
                    onChange={(event) => update({ maxRetries: Number(event.target.value) || 0 })}
                  />
                </Field>
                <Field label="AI retries" hint="Provider errors.">
                  <Input
                    type="number"
                    min={0}
                    max={6}
                    value={value.maxAiRetries}
                    onChange={(event) => update({ maxAiRetries: Number(event.target.value) || 0 })}
                  />
                </Field>
                <Field label="Verification" hint="Runner or static only.">
                  <Badge variant="success" className="mt-1.5 h-6 gap-1">
                    <ShieldCheck className="size-3" />
                    verified
                  </Badge>
                </Field>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-3 py-2">
                <span>
                  <span className="block text-[11px] font-medium text-zinc-300">
                    Strict TypeScript
                  </span>
                  <span className="block text-[10px] text-zinc-500">
                    Type errors fail the generated test before it leaves.
                  </span>
                </span>
                <Switch
                  checked={value.strictTypes}
                  onCheckedChange={(strictTypes) => update({ strictTypes })}
                  size="sm"
                  aria-label="Strict TypeScript"
                />
              </label>
            </Section>

            <Section
              id="appearance"
              icon={Sparkles}
              title="Appearance"
              summary={`${appearance.mode} · ${ACCENTS.find((item) => item.id === appearance.accentId)?.name ?? "accent"}`}
            >
              <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-3 py-2">
                <span className="min-w-0">
                  <span className="block text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
                    Accent
                  </span>
                  <span className="block text-[10px] leading-snug text-zinc-500">
                    Recolours the primary action, focus rings and the aurora.
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  {ACCENTS.map((accent) => (
                    <Hint key={accent.id} label={accent.name}>
                      <button
                        type="button"
                        onClick={() => setAccent(accent.base)}
                        aria-label={accent.name}
                        style={{ background: accent.base }}
                        className={cn(
                          "size-5 rounded-full ring-2 ring-offset-2 ring-offset-zinc-950 transition hover:scale-110",
                          appearance.accentId === accent.id ? "ring-white/80" : "ring-transparent",
                        )}
                      />
                    </Hint>
                  ))}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={toggleMode}>
                {appearance.mode === "dark" ? <Sun /> : <Moon />}
                {appearance.mode === "dark" ? "Light" : "Dark"} mode
              </Button>
            </Section>
          </Accordion>

          <Alert variant="warning">
            <Sparkles />
            <div>
              <AlertTitle>Draft controls</AlertTitle>
              <AlertDescription>
                Values update the mockup session only. The shipped dashboard stores settings in
                localStorage and sends keys as headers.
              </AlertDescription>
            </div>
          </Alert>
        </SheetBody>

        <SheetFooter>
          <Button variant="ghost" size="sm" onClick={() => onChange(DEFAULT_DRAFT_SETTINGS)}>
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const SECTION_TONE: Record<string, string> = {
  provider: "text-violet-300",
  sandbox: "text-sky-300",
  keys: "text-amber-300",
  pipeline: "text-indigo-300",
  appearance: "text-fuchsia-300",
};

function Section({
  id,
  icon: Icon,
  title,
  summary,
  children,
}: {
  id: string;
  icon: typeof Bot;
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <AccordionItem
      id={`settings-${id}`}
      value={id}
      className="scroll-mt-2 overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-900/30 px-3"
    >
      <AccordionTrigger className="hover:no-underline">
        <span className="flex min-w-0 items-center gap-2">
          <Icon className={cn("size-3.5 shrink-0", SECTION_TONE[id] ?? "text-zinc-500")} />
          <span className="text-[11px] font-semibold text-zinc-200">{title}</span>
          <span className="ml-2 truncate font-mono text-[9px] text-zinc-500">{summary}</span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-2.5">
        {children}
        <Separator className="mt-1 opacity-60" />
      </AccordionContent>
    </AccordionItem>
  );
}

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
