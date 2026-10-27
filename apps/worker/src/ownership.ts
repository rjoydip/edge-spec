/** CODEOWNERS lookup for backlog ownership. */
import { ownerForPath, parseCodeowners } from "@edge-spec/core/codeowners";
import type { GitHub } from "@edge-spec/core/github";

const OWNER_FILES = ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"];

/**
 * Reads the repository's CODEOWNERS once and returns a path -> owner lookup.
 * A missing or unreadable file simply means no owner, never a guessed one.
 */
export async function ownerLookup(
  github: GitHub,
  repo: string,
  ref: string,
  blobs: readonly string[],
): Promise<(path: string) => string | undefined> {
  const path = OWNER_FILES.find((candidate) => blobs.includes(candidate));
  if (!path) return () => undefined;
  try {
    const entries = parseCodeowners(await github.file(repo, path, ref));
    return (target) => ownerForPath(entries, target);
  } catch {
    return () => undefined;
  }
}
