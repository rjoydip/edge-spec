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
