/**
 * The generated test, highlighted. The highlighter and its grammars are only
 * needed once a test exists, so they are loaded on demand.
 */
import { Code } from "@vortexlabs/kirari-react";
import { javascript } from "@vortexlabs/kirari/languages/javascript";
import { jsx } from "@vortexlabs/kirari/languages/jsx";
import { tsx } from "@vortexlabs/kirari/languages/tsx";
import { typescript } from "@vortexlabs/kirari/languages/typescript";
// The highlighter theme travels with the highlighter.
import "@vortexlabs/kirari/theme.css";
import { cn } from "@edge-spec/ui";

function languageFor(path: string) {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  if (ext === ".tsx") return tsx;
  if (ext === ".jsx") return jsx;
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return javascript;
  return typescript;
}

export default function CodeView({
  path,
  code,
  className,
}: {
  path: string;
  code: string;
  className?: string;
}) {
  return (
    <Code
      language={languageFor(path)}
      aria-label="Code"
      className={cn(
        "kirari code-highlight no-scrollbar flex-1 overflow-auto bg-zinc-950/70 p-4 font-mono text-[11px] leading-relaxed",
        className,
      )}
    >
      {code}
    </Code>
  );
}
