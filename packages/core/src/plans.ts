/**
 * The pricing model. Catalog-first: every plan is declared here so the
 * dashboard pricing page, the account endpoints and the admin activation all
 * read the same table. No payment gateway yet — activation is manual via the
 * admin endpoint — so a plan carries no gateway ids, just its facts.
 */
export interface Plan {
  id: string;
  name: string;
  /** USD/month; 0 for free. */
  price: number;
  tagline: string;
  features: string[];
  /** Pipeline limits this tier allows; `-1` means uncapped. */
  limits: {
    /** Repositories tracked for history/backlog. */
    repos: number;
    /** Generation runs every rolling 24 hours (0 = the pipeline is locked). */
    runsPerDay: number;
    maxFiles: number;
  };
}

export const PLANS: readonly Plan[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    tagline: "For kicking the tires on a repo or two.",
    features: ["2 repositories", "10 runs per day", "3 tests per run", "Static validation only"],
    limits: { repos: 2, runsPerDay: 10, maxFiles: 3 },
  },
  {
    id: "pro",
    name: "Pro",
    price: 19,
    tagline: "The full pipeline, every day.",
    features: [
      "Unlimited repositories",
      "100 runs per day",
      "10 tests per run",
      "Bring your own AI provider",
      "Bring your own test runner",
      "Downloadable artifacts",
    ],
    limits: { repos: -1, runsPerDay: 100, maxFiles: 10 },
  },
  {
    id: "team",
    name: "Team",
    price: 99,
    tagline: "Everything Pro, with shared workspace memory.",
    features: [
      "Everything in Pro",
      "Unlimited runs",
      "Drift webhooks and retest graph",
      "Priority support",
    ],
    limits: { repos: -1, runsPerDay: -1, maxFiles: 15 },
  },
];

export const planById = (id: string | undefined): Plan | undefined =>
  PLANS.find((plan) => plan.id === (id ?? "free"));

export const isPlanId = (value: unknown): value is string =>
  typeof value === "string" && PLANS.some((plan) => plan.id === value);
