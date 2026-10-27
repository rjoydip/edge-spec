/** Golden-case comparison and provider/model scoring. Facts supplied by callers. */

export interface GoldenCase {
  id: string;
  path: string;
  expectedGaps: string[];
}

export interface GoldenResult {
  caseId: string;
  pass: boolean;
  missing: string[];
  unexpected: string[];
}

const sorted = (values: readonly string[]): string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

/** Compares a scan's gap paths with the golden expectation. */
export function compareGolden(
  caseId: string,
  actualGaps: readonly string[],
  expectedGaps: readonly string[],
): GoldenResult {
  const actual = new Set(sorted(actualGaps));
  const expected = new Set(sorted(expectedGaps));
  const missing = [...expected].filter((path) => !actual.has(path));
  const unexpected = [...actual].filter((path) => !expected.has(path));
  return { caseId, pass: missing.length === 0 && unexpected.length === 0, missing, unexpected };
}

export interface EvalOutcome {
  caseId: string;
  provider: string;
  model: string;
  /** Files the run generated. */
  generated: number;
  /** Files the runner executed successfully. */
  verified: number;
  /** Files a reviewer accepted or a PR carried. */
  accepted: number;
  /** Files marked flaky. */
  flaky: number;
  /** Provider-reported tokens, when measured. */
  tokens?: number;
}

export interface EvalScore {
  provider: string;
  model: string;
  runs: number;
  generated: number;
  /** Percentages, 0–100 with one decimal. */
  verifiedRate: number;
  acceptanceRate: number;
  flakeRate: number;
  /** Average provider-reported tokens; absent when no run reported usage. */
  avgTokens?: number;
}

const percent = (part: number, total: number): number =>
  total > 0 ? Math.round((part / total) * 1000) / 10 : 0;

/**
 * Scores supplied outcomes per provider/model. No cost is inferred here: tokens
 * are reported only when a run measured them, and callers can price them.
 */
export function scoreRuns(outcomes: readonly EvalOutcome[]): EvalScore[] {
  const groups = new Map<string, { provider: string; model: string; runs: EvalOutcome[] }>();
  for (const outcome of outcomes) {
    const key = `${outcome.provider}\u0000${outcome.model}`;
    const group = groups.get(key) ?? {
      provider: outcome.provider,
      model: outcome.model,
      runs: [],
    };
    group.runs.push(outcome);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(({ provider, model, runs }) => {
      const generated = runs.reduce((sum, run) => sum + run.generated, 0);
      const verified = runs.reduce((sum, run) => sum + run.verified, 0);
      const accepted = runs.reduce((sum, run) => sum + run.accepted, 0);
      const flaky = runs.reduce((sum, run) => sum + run.flaky, 0);
      const tokenRuns = runs.filter((run) => run.tokens !== undefined);
      const tokens = tokenRuns.reduce((sum, run) => sum + (run.tokens ?? 0), 0);
      return {
        provider,
        model,
        runs: runs.length,
        generated,
        verifiedRate: percent(verified, generated),
        acceptanceRate: percent(accepted, generated),
        flakeRate: percent(flaky, generated),
        ...(tokenRuns.length > 0 ? { avgTokens: Math.round(tokens / tokenRuns.length) } : {}),
      };
    })
    .sort(
      (left, right) =>
        right.verifiedRate - left.verifiedRate ||
        right.acceptanceRate - left.acceptanceRate ||
        left.provider.localeCompare(right.provider) ||
        left.model.localeCompare(right.model),
    );
}
