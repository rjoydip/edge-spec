/** Kirari-backed highlighting for the draft's spec and source viewers. */
import { Code } from "@vortexlabs/kirari-react";
import { json } from "@vortexlabs/kirari/languages/json";
import { typescript } from "@vortexlabs/kirari/languages/typescript";
import { yaml } from "@vortexlabs/kirari/languages/yaml";
import "@vortexlabs/kirari/theme.css";
import { cn } from "@edge-spec/ui";

const LANGUAGES = { json, typescript, yaml } as const;

export function HighlightedCode({
  code,
  language,
  className,
}: {
  code: string;
  language: keyof typeof LANGUAGES;
  className?: string;
}) {
  return (
    <Code
      language={LANGUAGES[language]}
      aria-label={`${language} source`}
      className={cn(
        "kirari code-highlight no-scrollbar max-h-[46vh] overflow-auto rounded-xl border border-zinc-800/70 bg-zinc-950/70 p-3 font-mono text-[11px] leading-5",
        className,
      )}
    >
      {code}
    </Code>
  );
}
