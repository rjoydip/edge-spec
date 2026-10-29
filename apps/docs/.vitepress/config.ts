import { defineConfig } from "vitepress";

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
        items: [{ text: "Overview", link: "/" }],
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
