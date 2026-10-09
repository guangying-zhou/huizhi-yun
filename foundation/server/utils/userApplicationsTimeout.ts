// A deployment may accommodate a slower runtime link without removing the
// deadline or changing authorization failure semantics.
export function userApplicationsTimeoutMs(value: unknown): number {
  const timeout = Number(value)
  return Number.isInteger(timeout) && timeout >= 1000 && timeout <= 15000 ? timeout : 3000
}
