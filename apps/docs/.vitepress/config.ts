import { defineConfig } from "vitepress";

const dev = process.env.NODE_ENV !== "production";
const WWW =
  process.env.VITE_WWW_URL ?? (dev ? "http://localhost:5175" : "https://edge-spec-www.pages.dev");
const APP =
  process.env.VITE_APP_URL ??
  (dev ? "http://localhost:5173" : "https://edge-spec.rjoydip.workers.dev");

export default defineConfig({
  lang: "en-US",
  title: "EdgeSpec",
  description:
    "Find untested code, generate tests with the model you choose, validate them, and open a pull request.",
  cleanUrls: true,
  appearance: "dark",
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
    ["meta", { name: "theme-color", content: "#09090b" }],
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap",
      },
    ],
  ],
  themeConfig: {
    logo: "/favicon.svg",
    siteTitle: "EdgeSpec",
    nav: [
      { text: "Home", link: WWW },
      { text: "Open app", link: APP, target: "_blank", rel: "noreferrer" },
      { text: "Architecture", link: "/architecture" },
      { text: "API", link: "/api" },
      { text: "CLI", link: "/cli" },
      { text: "MCP", link: "/mcp" },
      { text: "Configuration", link: "/configuration" },
      { text: "Deployment", link: "/deployment" },
      { text: "UI", link: "/ui" },
    ],
    sidebar: [
      {
        text: "Getting started",
        items: [
          { text: "Overview", link: "/" },
          { text: "Landing page", link: WWW },
          { text: "Open the app", link: APP },
        ],
      },
      {
        text: "Guide",
        items: [
          { text: "Architecture", link: "/architecture" },
          { text: "CLI", link: "/cli" },
          { text: "MCP server", link: "/mcp" },
          { text: "Configuration", link: "/configuration" },
          { text: "Deployment", link: "/deployment" },
          { text: "GitHub App", link: "/github-app" },
          { text: "UI guide", link: "/ui" },
        ],
      },
      {
        text: "Reference",
        items: [{ text: "API", link: "/api" }],
      },
    ],
    outline: { level: [2, 3], label: "On this page" },
    search: { provider: "local" },
    footer: {
      message: "Generated tests are a draft, not a proof.",
      copyright: "EdgeSpec",
    },
    docFooter: { prev: "Previous", next: "Next" },
    returnToTopLabel: "Back to top",
    sidebarMenuLabel: "Menu",
    darkModeSwitchLabel: "Theme",
    lightModeSwitchTitle: "Switch to light theme",
    darkModeSwitchTitle: "Switch to dark theme",
  },
});
