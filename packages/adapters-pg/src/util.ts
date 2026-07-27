/**
 * Coerce a timestamptz column value into a JS Date. `pg` returns timestamptz
 * columns as Date objects; PGlite may return either a Date or an ISO string.
 * Both produce the same absolute instant.
 */
export function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value === null || value === undefined) return new Date(NaN);
  return new Date(value as string);
}

/** Coerce a bigint/count column value into a number. `pg` returns bigint
 *  (including `count(*)`) as a STRING to avoid precision loss; PGlite may
 *  return a number. Both pass through Number(). */
export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}
