/**
 * The tree itself. It is loaded on demand: `@pierre/trees` is the heaviest
 * dependency in the app and only a file view needs it.
 */
import { useEffect, useMemo, useRef } from "react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { cn } from "@edge-spec/ui";
import { ancestorsOf, type PathTreeProps } from "./path-tree";

/**
 * The tree renders into a shadow root, so its search box is styled from the
 * inside. The spacing is what makes the field look like a field.
 */
const TREE_CSS = `
  [data-file-tree-search-container] {
    padding: 10px 10px 4px;
    margin-bottom: 2px;
  }
  [data-file-tree-search-input] {
    height: 32px;
    padding-inline: 10px;
  }
`;

export default function Tree({
  paths,
  selected,
  onSelect,
  className,
  decoration,
  menu,
}: PathTreeProps) {
  const fileSet = useMemo(() => new Set(paths), [paths]);
  // What the tree reported last time, so a fresh click can be told apart from
  // rows that were already selected.
  const seen = useRef(new Set(selected ? [selected] : []));

  const { model } = useFileTree({
    paths,
    // Only the `complete` set carries per-language colours.
    icons: "complete",
    density: "compact",
    search: true,
    unsafeCSS: TREE_CSS,
    // The tree is rebuilt when the file list changes, so every folder starts
    // open: filtering the list never collapses the view.
    initialExpansion: "open",
    initialSelectedPaths: selected ? [selected] : [],
    initialExpandedPaths: selected ? ancestorsOf(selected) : [],
    ...(decoration
      ? {
          renderRowDecoration: ({ item }) => {
            const label = decoration(item.path);
            if (!label) return null;
            return {
              text: label.text,
              ...(label.title ? { title: label.title } : {}),
              // The tree paints a decoration through its parts.
              ...(label.color ? { parts: [{ text: label.text, color: label.color }] } : {}),
            };
          },
        }
      : {}),
    onSelectionChange: (next) => {
      const added = next.filter((path) => !seen.current.has(path));
      seen.current = new Set(next);
      // The selection is a set in insertion order, so the newly added path is
      // the row the reader picked. Directories can be selected too.
      const picked = [...added].reverse().find((path) => fileSet.has(path));
      if (picked) onSelect(picked);
    },
  });

  // The reader picks a file somewhere else (the Overview, a search result),
  // so the tree follows it and brings it into view.
  useEffect(() => {
    if (!selected) return;
    try {
      model.scrollToPath(selected, { offset: "center" });
    } catch {
      // The tree may not have rendered the path yet.
    }
  }, [model, selected]);

  return (
    <FileTree
      model={model}
      className={cn("file-tree", className)}
      {...(menu
        ? {
            renderContextMenu: (item, context) => {
              const actions = menu(item);
              if (actions.length === 0) return null;
              return (
                <TreeMenu
                  actions={actions}
                  onClose={context.close}
                  anchor={{ top: context.anchorRect.top, left: context.anchorRect.left }}
                />
              );
            },
          }
        : {})}
    />
  );
}

/** A small menu anchored to the row that was clicked. */
function TreeMenu({
  actions,
  onClose,
  anchor,
}: {
  actions: { label: string; icon?: React.ReactNode; onSelect: () => void }[];
  onClose: () => void;
  anchor: { top: number; left: number };
}) {
  return (
    <div
      className="glass-panel fixed z-50 min-w-48 overflow-hidden rounded-xl p-1 shadow-2xl"
      style={{ top: Math.max(8, anchor.top), left: Math.max(8, anchor.left) }}
    >
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={() => {
            onClose();
            action.onSelect();
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-zinc-200 transition hover:bg-zinc-800"
        >
          {action.icon}
          {action.label}
        </button>
      ))}
    </div>
  );
}
