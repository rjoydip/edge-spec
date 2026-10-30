import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@edge-spec/ui/theme.css";
import { App } from "./App";
import "./index.css";

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
