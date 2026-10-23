/**
 * The file view. `@pierre/trees` renders a repository listing into a shadow
 * root: it ships VS Code-style file icons, virtualises long listings and
 * brings its own search. Its colours come from the `.file-tree` custom
 * properties in `tailwind.css`, so it inherits the theme and the accent.
 *
 * The tree engine is the heaviest dependency in the app, and only a file view
 * needs it, so the implementation is loaded on demand.
 */
import { lazy, Suspense, type ReactNode } from "react";
import { cn } from "@edge-spec/ui";

const Tree = lazy(() => import("./path-tree-impl"));

/** Every directory above a path, so the tree opens with the file in sight. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

/** A small label drawn at the end of a row. */
export interface RowDecoration {
  text: string;
  color?: string;
  title?: string;
}

export interface TreeMenuAction {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
}

export interface PathTreeProps {
  /** File paths, relative to the repository root. */
  paths: string[];
  /** The path the pane is showing. */
  selected?: string;
  onSelect: (path: string) => void;
  className?: string;
  /** A label for every row, e.g. the risk level of a gap. */
  decoration?: (path: string) => RowDecoration | null;
  /** Right-click menu on a row. */
  menu?: (item: { kind: "directory" | "file"; name: string; path: string }) => TreeMenuAction[];
}

export function PathTree(props: PathTreeProps) {
  return (
    <Suspense
      fallback={
        <div
          className={cn("h-full w-full animate-pulse rounded-xl bg-zinc-900/40", props.className)}
        />
      }
    >
      <Tree {...props} />
    </Suspense>
  );
}
