export function shippingCents(totalCents: number, member: boolean): number {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new Error("total must be a non-negative integer");
  }
  if (member) return 0;
  if (totalCents >= 5000) return 0;
  return 499;
}
