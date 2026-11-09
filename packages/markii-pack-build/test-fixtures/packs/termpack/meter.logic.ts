/** Shared between the React and terminal views: everything above the markup. */
export function meterFraction(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
