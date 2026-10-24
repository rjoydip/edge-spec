/**
 * Copy-in/copy-out for hosted drivers. Those providers own their filesystem, so
 * the runner uploads the workspace after the clone and downloads only the files
 * the run reads back. Bind-mount drivers never use this.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { EnvironmentFailure } from "./driver";

const UPLOAD_TOTAL_CAP = 50_000_000;
const SKIP = new Set(["node_modules", ".git", ".edgespec-home", "coverage", "dist", ".next"]);

/** A path relative to the workspace root, always with forward slashes. */
export function relativePath(root: string, target: string): string {
  return path.relative(root, target).replace(/\\/g, "/");
}

/** The remote path for a workspace-relative path. */
export function remotePath(remoteRoot: string, relative: string): string {
  return relative && relative !== "." ? `${remoteRoot}/${relative}` : remoteRoot;
}

/**
 * Walks the workspace, skipping dependencies and build output, and hands each
 * file to the provider. The 50 MB cap keeps a run from uploading a media repo.
 */
export async function uploadWorkspace(
  root: string,
  write: (relative: string, content: Buffer) => Promise<unknown>,
): Promise<void> {
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const local = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(local);
        continue;
      }
      if (!entry.isFile()) continue;
      const content = await readFile(local);
      total += content.length;
      if (total > UPLOAD_TOTAL_CAP) {
        throw new EnvironmentFailure("setup", "The workspace exceeds the 50 MB upload cap.");
      }
      await write(relativePath(root, local), content);
    }
  };
  await walk(root);
}

/**
 * Downloads the requested files into the host workspace. A reader may return
 * the bytes, or write the destination itself (Daytona does the latter).
 * Missing artifacts are expected: not every command produces them.
 */
export async function downloadArtifacts(
  root: string,
  paths: string[],
  read: (relative: string, local: string) => Promise<string | Uint8Array | void | null>,
): Promise<void> {
  for (const relative of paths) {
    const local = path.join(root, relative);
    await mkdir(path.dirname(local), { recursive: true });
    try {
      const content = await read(relative, local);
      if (typeof content === "string") await writeFile(local, content, "utf8");
      else if (content) await writeFile(local, content);
    } catch {
      // Missing artifacts are expected.
    }
  }
}
