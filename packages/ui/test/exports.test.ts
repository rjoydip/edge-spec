import { describe, expect, test } from "bun:test";
import { Badge, Button, Dialog, Input, Slider, Switch, ViewTabs, cn } from "../src";

describe("UI package", () => {
  test("exports the shared primitives", () => {
    for (const component of [Badge, Button, Dialog, Input, Slider, Switch, ViewTabs]) {
      expect(typeof component).toBe("function");
    }
  });

  test("merges Tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
