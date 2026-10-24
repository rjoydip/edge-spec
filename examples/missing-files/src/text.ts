export function titleCase(value: string): string {
  return value
    .trim()
    .replace(/\w\S*/g, (word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase());
}
