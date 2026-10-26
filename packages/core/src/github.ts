/**
 * GitHub REST, no SDK. Every call is one request the Worker can afford, and the
 * token belongs to the visitor — it is used for this call and never stored.
 */
import { PR_CHECK_MARKER, PR_CHECK_NAME, type PrCheckResult } from "./pr-check";
import { HttpError } from "./types";

const API = "https://api.github.com";
const USER_AGENT = "edge-spec";

export interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
}

export interface PullSummary {
  number: number;
  title: string;
  url: string;
  state: string;
  branch: string;
  createdAt: string;
  author: string;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

interface GitHubUser {
  login?: string;
}

interface GitHubPull {
  number: number;
  title: string;
  html_url: string;
  state: string;
  created_at: string;
  user?: GitHubUser | null;
  head?: { ref?: string } | null;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

/** Encodes each path segment but keeps the slashes GitHub needs. */
const encodePath = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

export class GitHub {
  constructor(
    private readonly token?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": USER_AGENT,
      "x-github-api-version": "2022-11-28",
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (options.body !== undefined) headers["content-type"] = "application/json";

    let response: Response;
    try {
      // Call as a standalone function: in Workers, invoking `this.fetchImpl(...)`
      // binds the instance and throws "Illegal invocation".
      const request = this.fetchImpl;
      response = await request(`${API}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      throw new HttpError(
        502,
        `GitHub unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      const text = await response.text();
      let message = text.slice(0, 300);
      try {
        const parsed = asRecord(JSON.parse(text));
        if (typeof parsed.message === "string") message = parsed.message;
      } catch {
        // Non-JSON error body: the truncated text is the best message available.
      }
      const hint =
        response.status === 401 || response.status === 403
          ? " (check your GitHub token and its scopes)"
          : response.status === 404
            ? " (repository or path not found, or the token cannot see it)"
            : "";
      throw new HttpError(response.status, `GitHub ${response.status}: ${message}${hint}`);
    }

    return (await response.json()) as T;
  }

  /** Recursive tree. GitHub caps this at 100k entries, more than a scan needs. */
  async tree(repo: string, ref: string): Promise<TreeEntry[]> {
    const data = await this.request<{ tree?: unknown }>(
      `/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    );
    const list = Array.isArray(data.tree) ? data.tree : [];
    return list.flatMap((item) => {
      const entry = asRecord(item);
      if (typeof entry.path !== "string") return [];
      const type = entry.type === "tree" || entry.type === "commit" ? entry.type : "blob";
      return [{ path: entry.path, type }];
    });
  }

  /** File contents at a ref, decoded from GitHub's base64. */
  async file(repo: string, path: string, ref?: string): Promise<string> {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const data = await this.request<{ content?: string; encoding?: string }>(
      `/repos/${repo}/contents/${encodePath(path)}${query}`,
    );
    if (typeof data.content !== "string") {
      throw new HttpError(400, `Not a file: ${path}`);
    }
    return decodeBase64(data.content);
  }

  async defaultBranch(repo: string): Promise<string> {
    const data = await this.request<{ default_branch?: string }>(`/repos/${repo}`);
    return data.default_branch ?? "main";
  }

  /** Branch names for the header picker. GitHub caps the page at 100. */
  async branches(repo: string): Promise<string[]> {
    const data = await this.request<unknown>(`/repos/${repo}/branches?per_page=100`);
    if (!Array.isArray(data)) return [];
    return data.flatMap((item) => {
      const branch = asRecord(item);
      return typeof branch.name === "string" ? [branch.name] : [];
    });
  }

  async headSha(repo: string, branch: string): Promise<string> {
    const data = await this.request<{ object?: { sha?: string } }>(
      `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    const sha = data.object?.sha;
    if (!sha) throw new HttpError(502, `Could not resolve the head of ${branch}.`);
    return sha;
  }

  async createBranch(repo: string, branch: string, sha: string): Promise<void> {
    await this.request(`/repos/${repo}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${branch}`, sha },
    });
  }

  async putFile(
    repo: string,
    path: string,
    content: string,
    message: string,
    branch: string,
  ): Promise<void> {
    await this.request(`/repos/${repo}/contents/${encodePath(path)}`, {
      method: "PUT",
      body: { message, content: encodeBase64(content), branch },
    });
  }

  async openPull(
    repo: string,
    input: { title: string; head: string; base: string; body: string; draft?: boolean },
  ): Promise<string> {
    const data = await this.request<{ html_url?: string }>(`/repos/${repo}/pulls`, {
      method: "POST",
      body: { ...input, draft: input.draft === true },
    });
    if (!data.html_url) throw new HttpError(502, "GitHub created the PR without returning a URL.");
    return data.html_url;
  }

  /** The first page of changed files: enough for an advisory changed-file scan. */
  async pullFiles(repo: string, number: number): Promise<string[]> {
    const data = await this.request<unknown>(`/repos/${repo}/pulls/${number}/files?per_page=100`);
    if (!Array.isArray(data)) return [];
    return data.flatMap((item) => {
      const file = asRecord(item);
      return typeof file.filename === "string" ? [file.filename] : [];
    });
  }

  /** Creates the check, or updates the one with our name on this commit. */
  async upsertCheck(repo: string, ref: string, check: PrCheckResult): Promise<number> {
    const data = await this.request<{ check_runs?: unknown }>(
      `/repos/${repo}/commits/${encodeURIComponent(ref)}/check-runs?check_name=${encodeURIComponent(PR_CHECK_NAME)}&per_page=1`,
    );
    const existing = Array.isArray(data.check_runs) ? asRecord(data.check_runs[0]) : {};
    const id = typeof existing.id === "number" ? existing.id : undefined;
    const body = {
      name: PR_CHECK_NAME,
      status: "completed",
      conclusion: check.conclusion,
      output: check.output,
    };
    if (id !== undefined) {
      await this.request(`/repos/${repo}/check-runs/${id}`, { method: "PATCH", body });
      return id;
    }
    const created = await this.request<{ id?: number }>(`/repos/${repo}/check-runs`, {
      method: "POST",
      body: { ...body, head_sha: ref },
    });
    return typeof created.id === "number" ? created.id : 0;
  }

  /** One marked comment per pull request; a re-run patches that comment. */
  async upsertPullComment(repo: string, number: number, body: string): Promise<number> {
    const data = await this.request<unknown>(
      `/repos/${repo}/issues/${number}/comments?per_page=100`,
    );
    const existing = Array.isArray(data)
      ? data
          .map(asRecord)
          .find((item) => typeof item.body === "string" && item.body.includes(PR_CHECK_MARKER))
      : undefined;
    const id = typeof existing?.id === "number" ? existing.id : undefined;
    if (id !== undefined) {
      await this.request(`/repos/${repo}/issues/comments/${id}`, {
        method: "PATCH",
        body: { body },
      });
      return id;
    }
    const created = await this.request<{ id?: number }>(
      `/repos/${repo}/issues/${number}/comments`,
      { method: "POST", body: { body } },
    );
    return typeof created.id === "number" ? created.id : 0;
  }

  async pulls(repo: string): Promise<PullSummary[]> {
    const data = await this.request<GitHubPull[]>(
      `/repos/${repo}/pulls?state=all&sort=created&direction=desc&per_page=20`,
    );
    return (Array.isArray(data) ? data : []).map((pull) => ({
      number: pull.number,
      title: pull.title,
      url: pull.html_url,
      state: pull.state,
      branch: pull.head?.ref ?? "",
      createdAt: pull.created_at,
      author: pull.user?.login ?? "unknown",
    }));
  }
}

/** UTF-8 safe base64 helpers. `btoa` alone mangles non-ASCII source. */
export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64(base64: string): string {
  const binary = atob(base64.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
