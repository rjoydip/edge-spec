import type { Generation, RunEvent, Validation } from "@edge-spec/core/types";

export interface GeneratedTest {
  generation: Generation;
  validation?: Validation;
}

/** Keeps the last generation/validation pair for each source file. */
export function collectGenerations(events: readonly RunEvent[]): Map<string, GeneratedTest> {
  const generated = new Map<string, GeneratedTest>();
  let current: string | undefined;
  for (const event of events) {
    if (event.type === "generation") {
      current = event.generation.sourcePath;
      generated.set(current, { generation: event.generation });
    } else if (event.type === "validation" && current) {
      const item = generated.get(current);
      if (item) item.validation = event.validation;
    }
  }
  return generated;
}

export function finalResult(
  events: readonly RunEvent[],
): Extract<RunEvent, { type: "result" }> | undefined {
  return events
    .filter((event): event is Extract<RunEvent, { type: "result" }> => event.type === "result")
    .at(-1);
}
