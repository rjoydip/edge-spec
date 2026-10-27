/** CODEOWNERS parsing. GitHub's rule: the last matching pattern wins. */

export interface CodeownersEntry {
  pattern: string;
  regex: RegExp;
  owners: string[];
}

function globOf(raw: string): RegExp {
  let pattern = raw.trim().replace(/^\/+/, "");
  if (pattern.endsWith("/")) pattern += "**";
  // A pattern without a slash matches a basename at any depth.
  if (!pattern.includes("/")) pattern = `**/${pattern}`;
  let escaped = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] as string;
    if (char === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        escaped += "(?:.*/)?";
        index += 2;
      } else {
        escaped += ".*";
        index += 1;
      }
    } else if (char === "*") {
      escaped += "[^/]*";
    } else {
      escaped += /[.+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
    }
  }
  return new RegExp(`^${escaped}$`);
}

/** Reads the non-comment lines; malformed lines are ignored, never guessed. */
export function parseCodeowners(text: string): CodeownersEntry[] {
  const entries: CodeownersEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    if (!pattern || owners.length === 0) continue;
    try {
      entries.push({
        pattern,
        regex: globOf(pattern),
        owners: owners.slice(0, 10).map((owner) => owner.slice(0, 120)),
      });
    } catch {
      // A pattern that cannot be compiled is not a rule.
    }
  }
  return entries;
}

/** Every owner for a path, last matching line first. */
export function ownersForPath(entries: readonly CodeownersEntry[], path: string): string[] {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.regex.test(path)) return entry.owners;
  }
  return [];
}

/** The single owner the backlog stores, or `undefined` when no rule matches. */
export function ownerForPath(
  entries: readonly CodeownersEntry[],
  path: string,
): string | undefined {
  return ownersForPath(entries, path)[0];
}
