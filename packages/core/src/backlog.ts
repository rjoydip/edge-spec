/** Durable test-debt items shared by the API, dashboard and storage. */

export type BacklogState = "open" | "accepted" | "rejected" | "ignored" | "closed";

export interface BacklogItem {
  repo: string;
  path: string;
  kind: string;
  state: BacklogState;
  owner?: string;
  risk?: string;
  reason?: string;
  firstSeen: number;
  lastSeen: number;
  closedAt?: number;
  lastRunId?: string;
}

/** The facts a scan contributes to the backlog. */
export interface BacklogGap {
  path: string;
  kind: string;
  owner?: string;
  risk?: string;
  reason?: string;
}
