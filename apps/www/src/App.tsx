import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";

// Docs live on a Vite dev server locally (`bun run dev:www` starts it through
// dev-worker) and on Cloudflare Pages in a build. Anchors stay in-page.
const DOCS = import.meta.env.DEV ? "http://localhost:5174" : "https://edge-spec-docs.pages.dev";

/* ------------------------------------------------------------------ icons */

type IconProps = { className?: string };

function Svg({ children, className }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

const Arrow = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

const Check = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="m4 12.5 5 5L20 6.5" />
  </Svg>
);

const Shield = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M12 3 5 6v5.5c0 4.3 2.9 7.9 7 9.5 4.1-1.6 7-5.2 7-9.5V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);

const Key = ({ className }: IconProps) => (
  <Svg className={className}>
    <circle cx="8" cy="8" r="4" />
    <path d="m11 11 9 9M17 17l2-2M14 14l2-2" />
  </Svg>
);

const Terminal = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="m4 7 4.5 5L4 17M11 17h9" />
  </Svg>
);

const PullRequest = ({ className }: IconProps) => (
  <Svg className={className}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M6 8.5v7M13 6h2.5A2.5 2.5 0 0 1 18 8.5V15" />
    <path d="M11 3.5 13 6l-2 2.5" />
  </Svg>
);

const Globe = ({ className }: IconProps) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.5 3.8 5.6 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.6-3.8-9S9.5 5.5 12 3Z" />
  </Svg>
);

const List = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </Svg>
);

/* -------------------------------------------------------------------- data */

type Tone = "plain" | "dim" | "ok" | "add" | "del" | "accent";
type Line = { text: string; tone?: Tone };

type Stage = { id: string; label: string; status: string; lines: Line[] };

const DEFAULT_STAGE: Stage = { id: "", label: "", status: "", lines: [] };

const STAGES: Stage[] = [
  {
    id: "scan",
    label: "Scan",
    status: "walking the tree",
    lines: [
      { text: "src/routes/payments.ts        no test found", tone: "dim" },
      { text: "src/routes/refunds.ts         no test found", tone: "dim" },
      { text: "src/lib/webhooks.ts           no test found", tone: "dim" },
      { text: "src/lib/ledger.ts             covered", tone: "ok" },
      { text: "src/routes/health.ts          trivial · skipped", tone: "dim" },
      { text: "openapi.yaml                  12 operations", tone: "accent" },
      { text: "ci.yml                         bun test, oxlint", tone: "dim" },
    ],
  },
  {
    id: "generate",
    label: "Generate",
    status: "model: your key, your choice",
    lines: [
      { text: 'import { test, expect } from "bun:test";', tone: "accent" },
      { text: 'import { refunds } from "../src/routes/refunds";' },
      { text: "" },
      { text: 'test("POST /refunds rejects an unknown charge", async () => {' },
      { text: '  const res = await refunds(request({ charge: "ch_404" }));' },
      { text: "  expect(res.status).toBe(404);" },
      { text: "});", tone: "ok" },
    ],
  },
  {
    id: "verify",
    label: "Verify",
    status: "sandbox running bun test",
    lines: [
      { text: "$ bun test tests/routes/refunds.test.ts", tone: "dim" },
      { text: "" },
      { text: "✓ POST /refunds rejects an unknown charge  (12ms)", tone: "ok" },
      { text: "✓ POST /refunds is idempotent               (9ms)", tone: "ok" },
      { text: "✓ GET /refunds lists only settled refunds   (7ms)", tone: "ok" },
      { text: "✓ POST /refunds validates the amount        (6ms)", tone: "ok" },
      { text: "" },
      { text: "4 pass · 0 fail · 31 expect() calls", tone: "add" },
    ],
  },
  {
    id: "review",
    label: "Review",
    status: "opening the pull request",
    lines: [
      { text: "acme/payments-api  ·  branch spec/refund-tests", tone: "dim" },
      { text: "" },
      { text: "+ 96  − 0   tests/routes/refunds.test.ts", tone: "add" },
      { text: "" },
      { text: "verdict   verified — a runner executed bun test", tone: "ok" },
      { text: "runner    sandbox · bwrap", tone: "dim" },
      { text: "secrets   0 stored server-side", tone: "accent" },
      { text: "" },
      { text: "PR #412 opened for review", tone: "accent" },
    ],
  },
];

const PROVIDERS = [
  "Workers AI",
  "OpenAI",
  "Anthropic",
  "Gemini",
  "Groq",
  "DeepSeek",
  "Mistral",
  "OpenRouter",
  "Any OpenAI-compatible",
];

const STEPS = [
  {
    n: "01",
    title: "Scan",
    tag: "classifyTree",
    body: "EdgeSpec walks the tree, matches every source file against its tests, reads your CI and formatter, and infers an OpenAPI surface when the repo has no spec.",
  },
  {
    n: "02",
    title: "Generate",
    tag: "resolveAi",
    body: "Workers AI out of the box, or your own provider and key. The key rides the request headers; the deployment never writes it down.",
  },
  {
    n: "03",
    title: "Verify",
    tag: "bun test",
    body: "Static checks always run. A suite reports verified only after a sandbox actually executed the tests — no runner means static check only.",
  },
  {
    n: "04",
    title: "Open",
    tag: "gh pr create",
    body: "The diff, the generated source and the honest verdict land in one pull request. You review code, not a black box.",
  },
];

const FEATURES = [
  {
    icon: Key,
    title: "Nothing to provision",
    body: "Repository, provider and knobs live in your browser. Keys travel as request headers. No account-scoped secrets sit on the server.",
    span: "",
  },
  {
    icon: Shield,
    title: "Honest by construction",
    body: "verified is true only when a runner ran the suite. Every other run says static check only, in the API and in the UI.",
    span: "",
  },
  {
    icon: Globe,
    title: "Runs where you do",
    body: "Cloudflare Workers, Bun, Vercel, AWS Lambda, Fly, Railway, Docker and Kubernetes behind one Hono app and five ports.",
    span: "",
  },
  {
    icon: Terminal,
    title: "Terminal and agent",
    body: "scan, generate, run and watch in the CLI, plus a stdio MCP server that wraps the same HTTP client — one behavior everywhere.",
    span: "",
  },
  {
    icon: List,
    title: "Deterministic contracts",
    body: "When an OpenAPI document exists, contract tests are generated without a model. No tokens spent on what a spec already knows.",
    span: "",
  },
  {
    icon: PullRequest,
    title: "Gaps, not guesses",
    body: "Risk is a path heuristic and coverage comes only from an LCOV report. No report means not measured — never an invented percentage.",
    span: "",
  },
];

/* --------------------------------------------------------------- utilities */

function useReveal() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (!("IntersectionObserver" in window)) {
      nodes.forEach((n) => n.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.15 },
    );
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, []);
}

function useScrollProgress() {
  const bar = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      if (bar.current) bar.current.style.transform = `scaleX(${progress})`;
      setScrolled(window.scrollY > 24);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return { bar, scrolled };
}

/* ------------------------------------------------------------------ pieces */

function Mark({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="mark" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#a5b4fc" />
          <stop offset="0.45" stopColor="#6366f1" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#mark)" />
      <path
        d="M13.2 9.5 8.5 16l4.7 6.5M18.8 9.5 23.5 16l-4.7 6.5"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="1.9" fill="#c7d2fe" />
    </svg>
  );
}

const TONE: Record<Tone, string> = {
  plain: "text-zinc-300",
  dim: "text-zinc-500",
  ok: "text-emerald-400",
  add: "text-emerald-300",
  del: "text-rose-400",
  accent: "text-brand-soft",
};

function RunCard() {
  const [index, setIndex] = useState(0);
  const stage = STAGES[index] ?? DEFAULT_STAGE;
  // Fill reaches the active dot: the first dot is 0%, the last 100%.
  const width = `${(index / (STAGES.length - 1)) * 100}%`;

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setIndex(STAGES.length - 1);
      return;
    }
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % STAGES.length);
    }, 3400);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="card float mx-auto w-full max-w-3xl text-left shadow-[0_40px_120px_-40px_rgb(79_70_229/0.55)] backdrop-blur-sm">
      {/* window chrome */}
      <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
        <span className="flex gap-1.5" aria-hidden="true">
          <i className="size-2.5 rounded-full bg-rose-500/70" />
          <i className="size-2.5 rounded-full bg-amber-400/70" />
          <i className="size-2.5 rounded-full bg-emerald-400/70" />
        </span>
        <p className="truncate font-mono text-xs text-zinc-400">
          <span className="text-zinc-500">github.com/</span>acme/payments-api
        </p>
        <span className="ml-auto hidden items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/8 px-2.5 py-1 font-mono text-[10px] tracking-wider text-emerald-300 uppercase sm:flex">
          <span className="pulse size-1.5 rounded-full bg-emerald-400" />
          live run
        </span>
      </div>

      {/* stage rail */}
      <div className="relative px-4 pt-4 pb-2">
        <div className="relative">
          <div className="rail-track">
            <div className="rail-fill" style={{ width }} />
          </div>
          <ol className="relative grid grid-cols-4">
            {STAGES.map((item, i) => {
              const active = i === index;
              const done = i < index;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-current={active ? "step" : undefined}
                    className="group flex w-full flex-col items-center gap-2 text-center"
                  >
                    <span
                      className={`size-3 rounded-full border transition-all duration-500 ${
                        active
                          ? "pulse border-brand bg-brand"
                          : done
                            ? "border-brand/60 bg-brand/60"
                            : "border-white/20 bg-ink"
                      }`}
                    />
                    <span
                      className={`font-mono text-[10px] tracking-[0.18em] uppercase transition-colors ${
                        active ? "text-white" : done ? "text-zinc-400" : "text-zinc-600"
                      }`}
                    >
                      {item.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {/* console */}
      <div className="border-t border-white/8 bg-black/35 px-4 py-4">
        <pre
          key={stage.id}
          className="min-h-[12rem] overflow-x-auto font-mono text-[10.5px] leading-5 sm:min-h-[13.5rem] sm:text-[13px] sm:leading-6"
        >
          {stage.lines.map((line, i) => (
            <div
              key={`${stage.id}-${i}`}
              className={`code-line ${TONE[line.tone ?? "plain"]}`}
              style={{ "--i": i } as CSSProperties}
            >
              {line.text || "\u00a0"}
              {i === stage.lines.length - 1 && <span className="cursor ml-0.5" />}
            </div>
          ))}
        </pre>
      </div>

      {/* status bar */}
      <div className="flex items-center gap-2 border-t border-white/8 px-4 py-3">
        <span className="pulse size-1.5 shrink-0 rounded-full bg-brand" />
        <p className="truncate font-mono text-[11px] text-zinc-500">
          <span className="text-zinc-300">{stage.id}</span> · {stage.status}
        </p>
        <span className="ml-auto flex shrink-0 items-center gap-1 rounded-md border border-white/10 px-2 py-1 font-mono text-[10px] text-zinc-400">
          <Check className="size-3 text-emerald-400" />
          {index === 3 ? "PR #412" : "validating"}
        </span>
      </div>
    </div>
  );
}

function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
}: {
  id: string;
  eyebrow: string;
  title: ReactNode;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="relative mx-auto w-full max-w-6xl px-5 py-24 sm:px-8 sm:py-32">
      <header className="mb-14 max-w-2xl">
        <p className="eyebrow mb-4" data-reveal>
          {eyebrow}
        </p>
        <h2 className="display text-3xl font-semibold sm:text-5xl" data-reveal>
          {title}
        </h2>
        {lead && (
          <p className="mt-5 text-base leading-relaxed text-zinc-400 sm:text-lg" data-reveal>
            {lead}
          </p>
        )}
      </header>
      {children}
    </section>
  );
}

function Hero({ onMove }: { onMove: (event: ReactPointerEvent<HTMLElement>) => void }) {
  return (
    <section
      className="hero hero-grid relative overflow-hidden pt-32 pb-20 sm:pt-40"
      onPointerMove={onMove}
    >
      <div className="spotlight" aria-hidden="true" />
      <div className="aurora aurora-a" aria-hidden="true" />
      <div className="aurora aurora-b" aria-hidden="true" />
      <div className="aurora aurora-c" aria-hidden="true" />

      <div className="relative mx-auto max-w-5xl px-5 text-center sm:px-8">
        <p className="eyebrow mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/3 px-3.5 py-1.5 tracking-[0.2em]">
          <span className="pulse size-1.5 rounded-full bg-brand" />
          open source · cloudflare native
        </p>

        <h1 className="display mx-auto max-w-4xl text-[2.75rem] font-semibold sm:text-6xl md:text-7xl">
          Find the gaps.
          <br />
          <span className="grad-text">Ship the tests.</span>
        </h1>

        <p className="mx-auto mt-7 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg">
          EdgeSpec scans a GitHub repository, generates a{" "}
          <code className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[0.9em] text-zinc-200">
            bun:test
          </code>{" "}
          with the model you choose, verifies it honestly, and opens the pull request.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <a className="btn btn-primary group" href={DOCS} target="_blank" rel="noreferrer">
            Get started
            <Arrow className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />{" "}
          </a>
          <a className="btn btn-ghost" href="#how">
            See how it works
          </a>
        </div>

        <dl className="mx-auto mt-7 flex max-w-xl flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-[11px] text-zinc-500">
          {[
            ["8", "providers"],
            ["1", "command"],
            ["0", "secrets stored"],
          ].map(([value, label]) => (
            <div key={label} className="flex items-baseline gap-1.5">
              <dt className="text-sm text-zinc-200">{value}</dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-16 sm:mt-20" data-reveal>
          <RunCard />
        </div>
      </div>
    </section>
  );
}

function Providers() {
  return (
    <div id="providers" className="relative border-y border-white/8 bg-white/2 py-6">
      <p className="eyebrow mb-5 text-center">bring your own model</p>
      <div
        className="marquee relative mx-auto max-w-6xl overflow-hidden px-5"
        aria-label="Supported model providers"
      >
        <div className="marquee-track">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex shrink-0 items-center gap-14" aria-hidden={copy === 1}>
              {PROVIDERS.map((name) => (
                <span
                  key={`${copy}-${name}`}
                  className="font-mono text-xs tracking-[0.2em] whitespace-nowrap text-zinc-500 uppercase transition-colors hover:text-zinc-200"
                >
                  {name}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function How() {
  return (
    <Section
      id="how"
      eyebrow="the pipeline"
      title={
        <>
          Four steps,
          <br className="hidden sm:block" /> no hand-waving.
        </>
      }
      lead="Each step is a plain module you can read: classify, generate, validate, open. The same pipeline backs the dashboard, the CLI and the MCP server."
    >
      <ol className="grid gap-4 md:grid-cols-2">
        {STEPS.map((step, i) => (
          <li
            key={step.n}
            className="card card-lift group flex gap-5 p-6 sm:p-7"
            data-reveal
            style={{ transitionDelay: `${i * 70}ms` }}
          >
            <div className="flex flex-col items-center gap-3">
              <span className="font-mono text-[11px] text-zinc-500">{step.n}</span>
              <span className="h-full w-px bg-gradient-to-b from-white/20 to-transparent" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-lg font-semibold">{step.title}</h3>
                <code className="rounded border border-white/10 bg-black/30 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
                  {step.tag}
                </code>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Features() {
  return (
    <Section
      id="features"
      eyebrow="what you get"
      title={
        <>
          Honest by default.
          <br className="hidden sm:block" /> Boring where it counts.
        </>
      }
      lead="No stored keys. No invented coverage. No “passed” without a runner. The interesting part is the pipeline; everything around it is deliberately plain."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }, i) => (
          <article
            key={title}
            className="card card-lift p-6"
            data-reveal
            style={{ transitionDelay: `${(i % 3) * 80}ms` }}
          >
            <span className="inline-flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/4 text-brand-soft">
              <Icon className="size-4.5" />
            </span>
            <h3 className="mt-4 text-base font-semibold">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">{body}</p>
          </article>
        ))}
      </div>
    </Section>
  );
}

function Verdict() {
  return (
    <section className="relative mx-auto w-full max-w-6xl px-5 pb-8 sm:px-8">
      <div className="card overflow-hidden" data-reveal>
        <div className="grid gap-0 lg:grid-cols-2">
          <div className="border-b border-white/8 p-8 sm:p-12 lg:border-r lg:border-b-0">
            <p className="eyebrow mb-4">the rule</p>
            <h2 className="display text-3xl font-semibold sm:text-4xl">
              A static check
              <br />
              is not a pass.
            </h2>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-zinc-400 sm:text-base">
              Most tools call a generated file “verified” the moment it compiles. EdgeSpec reserves
              that word for a suite a runner actually executed. Everything else is labelled for what
              it is.
            </p>
            <div className="mt-7 flex flex-wrap gap-2 font-mono text-[11px]">
              <span className="rounded-full border border-emerald-400/25 bg-emerald-400/8 px-3 py-1.5 text-emerald-300">
                verified · runner executed bun test
              </span>
              <span className="rounded-full border border-amber-400/25 bg-amber-400/8 px-3 py-1.5 text-amber-300">
                static check only
              </span>
            </div>
          </div>

          <div className="bg-black/35 p-8 sm:p-12">
            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              validation result
            </div>
            <pre className="mt-5 overflow-x-auto font-mono text-[12.5px] leading-7">
              <code>
                <div className="text-zinc-500">$ bun test</div>
                <div className="text-emerald-400">✓ 4 pass</div>
                <div className="text-rose-400">✗ 0 fail</div>
                <div className="text-zinc-500">31 expect() calls · 34ms</div>
                <div className="mt-4 text-zinc-500">verdict</div>
                <div className="text-emerald-300">
                  verified <span className="text-zinc-600">// runner: sandbox</span>
                </div>
                <div className="mt-3 text-zinc-500">without a runner</div>
                <div className="text-amber-300">static check only</div>
              </code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

function CallToAction() {
  return (
    <section className="relative mx-auto w-full max-w-6xl px-5 py-28 sm:px-8 sm:py-36">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/6 to-transparent px-6 py-16 text-center sm:px-14 sm:py-20">
        <div
          className="aurora"
          aria-hidden="true"
          style={{
            top: "-7rem",
            right: "-7rem",
            width: "26rem",
            height: "26rem",
            background: "rgb(34 211 238 / 0.24)",
            opacity: 0.4,
          }}
        />
        <div
          className="aurora"
          aria-hidden="true"
          style={{
            bottom: "-9rem",
            left: "32%",
            width: "24rem",
            height: "24rem",
            background: "rgb(217 70 239 / 0.2)",
            opacity: 0.35,
            animationDelay: "-9s",
          }}
        />
        <p className="eyebrow mb-5">your move</p>
        <h2 className="display mx-auto max-w-2xl text-4xl font-semibold sm:text-6xl">
          Your repo has gaps.
          <br />
          <span className="grad-text">Give them a spec.</span>
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-sm leading-relaxed text-zinc-400 sm:text-base">
          Point EdgeSpec at a repository, pick a model, and watch a test go from gap to verified
          pull request.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <a className="btn btn-primary group" href={DOCS} target="_blank" rel="noreferrer">
            Read the docs
            <Arrow className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
          </a>
          <a className="btn btn-ghost" href="#how">
            Back to the pipeline
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/8">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:grid-cols-2 sm:px-8 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2.5">
            <Mark size={28} />
            <span className="text-sm font-semibold tracking-tight">EdgeSpec</span>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-zinc-500">
            Untested code, tested. Scan, generate, verify, open the pull request — with the model
            you already trust.
          </p>
        </div>

        <nav aria-label="Product">
          <p className="eyebrow mb-4">Product</p>
          <ul className="space-y-2.5 text-sm text-zinc-400">
            <li>
              <a className="transition-colors hover:text-white" href="#how">
                How it works
              </a>
            </li>
            <li>
              <a className="transition-colors hover:text-white" href="#features">
                Features
              </a>
            </li>
            <li>
              <a className="transition-colors hover:text-white" href="#providers">
                Providers
              </a>
            </li>
          </ul>
        </nav>

        <nav aria-label="Resources">
          <p className="eyebrow mb-4">Resources</p>
          <ul className="space-y-2.5 text-sm text-zinc-400">
            <li>
              <a
                className="transition-colors hover:text-white"
                href={DOCS}
                target="_blank"
                rel="noreferrer"
              >
                Documentation
              </a>
            </li>
            <li>
              <a
                className="transition-colors hover:text-white"
                href={`${DOCS}/cli`}
                target="_blank"
                rel="noreferrer"
              >
                CLI
              </a>
            </li>
            <li>
              <a
                className="transition-colors hover:text-white"
                href={`${DOCS}/mcp`}
                target="_blank"
                rel="noreferrer"
              >
                MCP server
              </a>
            </li>
          </ul>
        </nav>
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 border-t border-white/8 px-5 py-6 font-mono text-[11px] text-zinc-600 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>© {new Date().getFullYear()} EdgeSpec</p>
        <p>no server-side user config · keys travel per request</p>
      </div>
    </footer>
  );
}

/* --------------------------------------------------------------------- app */

export function App() {
  const { bar, scrolled } = useScrollProgress();
  useReveal();

  const onMove = (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();
    target.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    target.style.setProperty("--my", `${event.clientY - rect.top}px`);
  };

  return (
    <div id="top">
      <div className="grain" aria-hidden="true" />

      <header className="fixed inset-x-0 top-0 z-50">
        <div
          className={`nav-glass relative border-b ${scrolled ? "nav-scrolled" : "border-transparent"}`}
        >
          <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-5 sm:px-8">
            <a className="flex items-center gap-2.5" href="#top" aria-label="EdgeSpec home">
              <Mark size={30} />
              <span className="text-sm font-semibold tracking-tight">EdgeSpec</span>
            </a>

            <nav
              aria-label="Sections"
              className="ml-auto hidden items-center gap-7 text-[13px] text-zinc-400 md:flex"
            >
              <a className="transition-colors hover:text-white" href="#how">
                How it works
              </a>
              <a className="transition-colors hover:text-white" href="#features">
                Features
              </a>
              <a className="transition-colors hover:text-white" href="#verdict">
                Validation
              </a>
            </nav>

            <a
              className="btn btn-primary ml-auto h-9 px-4 text-[13px] md:ml-0"
              href={DOCS}
              target="_blank"
              rel="noreferrer"
            >
              Read the docs
              <Arrow className="size-3.5" />
            </a>
          </div>

          {/* Progress rides the header rule and shares the nav's gutters. */}
          <div className="pointer-events-none absolute inset-x-0 -bottom-px">
            <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
              <div className="h-0.5 overflow-hidden rounded-full bg-white/8">
                <div ref={bar} className="scroll-progress h-full w-full" aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
      </header>

      <main>
        <Hero onMove={onMove} />
        <Providers />
        <How />
        <Features />
        <div id="verdict">
          <Verdict />
        </div>
        <CallToAction />
      </main>

      <Footer />
    </div>
  );
}
