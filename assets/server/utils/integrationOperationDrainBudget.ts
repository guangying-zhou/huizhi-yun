export function createAssetsDrainBudget(options: { maxClaims: number, maxWallTimeMs: number, claimReserveMs: number, now?: () => number }) {
  if (!Number.isSafeInteger(options.maxClaims) || options.maxClaims < 1 || options.maxClaims > 25) throw new Error('maxClaims must be between 1 and 25.')
  if (!Number.isSafeInteger(options.maxWallTimeMs) || options.maxWallTimeMs < 12_000 || options.maxWallTimeMs > 45_000) throw new Error('maxWallTimeMs must be between 12000 and 45000.')
  if (!Number.isSafeInteger(options.claimReserveMs) || options.claimReserveMs < 10_000 || options.claimReserveMs > options.maxWallTimeMs) throw new Error('claimReserveMs must be between 10000 and maxWallTimeMs.')
  const now = options.now || Date.now
  const deadline = now() + options.maxWallTimeMs
  let claimed = 0
  return {
    canClaim: () => claimed < options.maxClaims && deadline - now() >= options.claimReserveMs,
    recordClaim: () => { claimed += 1 },
    claimed: () => claimed,
    stoppedBy: (empty: boolean): 'empty' | 'max_claims' | 'max_wall_time' => empty ? 'empty' : claimed >= options.maxClaims ? 'max_claims' : 'max_wall_time'
  }
}
