/**
 * A local project path is only useful while the dashboard runs on localhost:
 * Vite serves the read-only file API from the developer's machine. A deployed
 * dashboard has no filesystem to read.
 */
export function isLocalPathInput(value: string): boolean {
  const raw = value.trim();
  if (!raw) return false;
  // A file:// URL is a local path, not a repository.
  if (/^file:/i.test(raw)) return true;
  // Any backslash indicates a Windows path, never a GitHub repository.
  if (raw.includes("\\")) return true;
  if (raw === "~" || raw.startsWith("~/") || raw.startsWith("~\\")) return true;
  if (
    raw.startsWith("./") ||
    raw.startsWith("../") ||
    raw.startsWith(".\\") ||
    raw.startsWith("..\\")
  ) {
    return true;
  }
  // POSIX absolute path.
  if (raw.startsWith("/")) return true;
  // Windows drive path or UNC share.
  return /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\");
}
