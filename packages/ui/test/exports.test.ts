import { describe, expect, test } from "bun:test";
import {
  AlertDialog,
  Badge,
  Button,
  Card,
  Checkbox,
  Collapsible,
  Dialog,
  DropdownMenu,
  Input,
  Popover,
  Progress,
  RadioGroup,
  ScrollArea,
  Sheet,
  Skeleton,
  Slider,
  Switch,
  Table,
  Tooltip,
  ViewTabs,
  cn,
} from "../src";

describe("UI package", () => {
  test("exports the shared primitives", () => {
    for (const component of [
      AlertDialog,
      Badge,
      Button,
      Card,
      Checkbox,
      Collapsible,
      Dialog,
      DropdownMenu,
      Input,
      Popover,
      Progress,
      RadioGroup,
      ScrollArea,
      Sheet,
      Skeleton,
      Slider,
      Switch,
      Table,
      Tooltip,
      ViewTabs,
    ]) {
      expect(component).toBeDefined();
    }
  });

  test("merges Tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
