/**
 * Where the dashboard is running. The deployment's own Workers AI binding is
 * a local development convenience: a deployed Worker must not spend the
 * owner's quota for a visitor, so the binding is only used when the visitor
 * explicitly asks for it.
 */
export function isLocalHost(hostname?: string): boolean {
  const host = hostname ?? (typeof window === "undefined" ? "" : window.location.hostname);
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/**
 * True only under the Vite dev server. The Worker serves the built assets even
 * when it runs on localhost, so the hostname cannot tell the two apart. Local
 * sandbox drivers are a dev-server convenience.
 */
export function isLocalDashboard(): boolean {
  return import.meta.env?.DEV === true;
}
