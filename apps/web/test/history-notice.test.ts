/**
 * The settings panel reads `/api/health` instead of assuming D1, so the copy
 * must change with the capability and never name a host-specific binding.
 */
import { describe, expect, it } from "bun:test";
import { historyNotice } from "../src/components/agent/history-notice";

const capabilities = (history: boolean) =>
  ({ history }) as NonNullable<Parameters<typeof historyNotice>[0]>;

describe("history notice", () => {
  it("names the missing database when history is off", () => {
    const notice = historyNotice(capabilities(false));
    expect(notice).toContain("EDGESPEC_DB_URL");
    expect(notice).toContain("RUNS_DB");
  });

  it("does not blame a missing database when one is bound", () => {
    const notice = historyNotice(capabilities(true));
    expect(notice).not.toContain("no history database is bound");
    expect(notice).toContain("not enabled");
  });

  it("stays generic when health is unavailable", () => {
    expect(historyNotice(undefined)).toBe("Not enabled on this deployment.");
  });

  it("never hard-codes D1", () => {
    for (const value of [undefined, capabilities(true), capabilities(false)]) {
      expect(historyNotice(value)).not.toContain("D1");
    }
  });
});
