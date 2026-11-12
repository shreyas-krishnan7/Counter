export function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** PayPal amount string, e.g. "120.00" */
export function toValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function fromValue(value: string | number | undefined): number {
  if (value === undefined || value === null) return NaN;
  return Math.round(Number(value) * 100);
}
