/**
 * Appearance store: dark/light plus the accent.
 *
 * CSS does the work — light mode remaps the zinc ramp and the accent is one
 * `--accent-base` hex — so this module only decides which values to write and
 * remembers them. `index.html` applies the stored values before first paint.
 */
import { useSyncExternalStore } from "react";

export type ThemeMode = "dark" | "light";

export interface Accent {
  id: string;
  name: string;
  base: string;
}

export const ACCENTS: Accent[] = [
  { id: "indigo", name: "Indigo", base: "#4f46e5" },
  { id: "blue", name: "Blue", base: "#2563eb" },
  { id: "violet", name: "Violet", base: "#7c3aed" },
  { id: "fuchsia", name: "Fuchsia", base: "#a21caf" },
  { id: "rose", name: "Rose", base: "#e11d48" },
  { id: "orange", name: "Orange", base: "#ea580c" },
  { id: "amber", name: "Amber", base: "#d97706" },
  { id: "teal", name: "Teal", base: "#0f766e" },
  { id: "emerald", name: "Emerald", base: "#047857" },
  { id: "slate", name: "Slate", base: "#475569" },
];

const DEFAULT_ACCENT = ACCENTS[0] as Accent;
const THEME_KEY = "edgespec:theme";
const ACCENT_KEY = "edgespec:accent";

export interface Appearance {
  mode: ThemeMode;
  accentBase: string;
  accentId: string;
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice still applies for this session.
  }
}

function accentIdFor(base: string): string {
  return ACCENTS.find((a) => a.base.toLowerCase() === base.toLowerCase())?.id ?? DEFAULT_ACCENT.id;
}

function load(): Appearance {
  const base = read(ACCENT_KEY) ?? DEFAULT_ACCENT.base;
  return {
    mode: read(THEME_KEY) === "light" ? "light" : "dark",
    accentBase: base,
    accentId: accentIdFor(base),
  };
}

let state: Appearance = load();
const listeners = new Set<() => void>();

function emit(next: Appearance): void {
  state = next;
  for (const listener of listeners) listener();
}

const THEME_COLORS: Record<ThemeMode, string> = {
  dark: "#09090b",
  light: "#fafafa",
};

function applyAppearance(appearance: Appearance = state): void {
  const root = document.documentElement;
  const light = appearance.mode === "light";
  root.classList.toggle("light", light);
  root.classList.toggle("dark", !light);
  root.style.colorScheme = light ? "light" : "dark";
  root.style.setProperty("--accent-base", appearance.accentBase);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[appearance.mode]);
}

export function setMode(mode: ThemeMode): void {
  write(THEME_KEY, mode);
  applyAppearance({ ...state, mode });
  emit({ ...state, mode });
}

export function toggleMode(): void {
  setMode(state.mode === "dark" ? "light" : "dark");
}

export function setAccent(base: string): void {
  write(ACCENT_KEY, base);
  const next = { ...state, accentBase: base, accentId: accentIdFor(base) };
  applyAppearance(next);
  emit(next);
}

function subscribeAppearance(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const appearanceSnapshot = (): Appearance => state;

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribeAppearance, appearanceSnapshot, appearanceSnapshot);
}
