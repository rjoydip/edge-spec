/**
 * Artifact downloads, client-side. The generated source never persists
 * server-side, so the bundle is built in the browser from exactly what was
 * reviewed — no server round trip, nothing extra stored (invariant 1).
 */
import { zipSync, strToU8 } from "fflate";

export interface ArtifactFile {
  testPath: string;
  code: string;
}

/** Builds a zip of the reviewed test files and saves it. */
export function downloadArtifactZip(
  files: readonly ArtifactFile[],
  name = `edgespec-tests-${new Date().toISOString().slice(0, 10)}`,
): void {
  if (files.length === 0) return;
  const zip = zipSync(
    Object.fromEntries(files.map((file) => [file.testPath, strToU8(file.code)])),
    {
      level: 6,
    },
  );
  save(new Blob([zip], { type: "application/zip" }), `${name}.zip`);
}

/** Saves one generated file. */
export function downloadArtifactFile(file: ArtifactFile): void {
  save(
    new Blob([file.code], { type: "text/plain;charset=utf-8" }),
    file.testPath.split("/").pop() ?? "test.ts",
  );
}

function save(blob: Blob, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(anchor.href);
}
