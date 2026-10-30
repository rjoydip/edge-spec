/**
 * Cloud names allow only lowercase letters, numbers and hyphens, but a stage is
 * free-form (`live_$USER`, `pr_123`). Fold it into a legal slug so a deploy does
 * not fail on an invalid bucket or Worker name.
 */
export function stageSlug(stage: string): string {
  const slug = stage
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "");
  return slug || "dev";
}
