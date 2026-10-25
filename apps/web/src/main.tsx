import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@edge-spec/ui/theme.css";
import { App } from "./App";
import { setMode } from "./lib/theme";
import "./tailwind.css";

const root = document.getElementById("root");
/** `?draft` renders the redesign mockup; the shipped dashboard stays the default. */
const params = new URLSearchParams(window.location.search);
const draft = params.has("draft");
/** `?draft&theme=light` reviews the light palette without touching stored settings. */
const theme = params.get("theme");
if (draft && (theme === "light" || theme === "dark")) setMode(theme);
/** Lazy so the mockup never ships in the dashboard's chunk. */
const AgentWorkspaceDraft = lazy(() =>
  import("./draft/agent-workspace").then((module) => ({ default: module.AgentWorkspaceDraft })),
);

if (root) {
  createRoot(root).render(
    <StrictMode>
      {draft ? (
        <Suspense fallback={null}>
          <AgentWorkspaceDraft />
        </Suspense>
      ) : (
        <App />
      )}
    </StrictMode>,
  );
}
