import { Code } from "@vortexlabs/kirari-react";
import { json } from "@vortexlabs/kirari/languages/json";
import { yaml } from "@vortexlabs/kirari/languages/yaml";
import "@vortexlabs/kirari/theme.css";
import { cn } from "@edge-spec/ui";

export default function RawSpecView({
  path,
  code,
  className,
}: {
  path: string;
  code: string;
  className?: string;
}) {
  const language = /\.ya?ml$/i.test(path) ? yaml : json;
  return (
    <Code
      language={language}
      aria-label="Raw spec"
      className={cn(
        "kirari code-highlight no-scrollbar flex-1 overflow-auto bg-zinc-950/70 p-4 font-mono text-[11px] leading-relaxed",
        className,
      )}
    >
      {code}
    </Code>
  );
}
