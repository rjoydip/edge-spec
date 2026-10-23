import type { Gap } from "./types";

/** Next gap after `selected` that has no generated test, wrapping around once. */
export function nextPendingGap(
  gaps: Gap[],
  generatedPaths: string[],
  selected: string,
): Gap | undefined {
  const pending = new Set(
    gaps
      .filter((gap) => gap.path !== selected && !generatedPaths.includes(gap.path))
      .map((gap) => gap.path),
  );
  if (pending.size === 0) return undefined;

  const index = gaps.findIndex((gap) => gap.path === selected);
  const ordered = index === -1 ? gaps : [...gaps.slice(index + 1), ...gaps.slice(0, index + 1)];
  return ordered.find((gap) => pending.has(gap.path));
}
