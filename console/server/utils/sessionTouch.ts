const CONSOLE_SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000

function utcTimestamp(value: string) {
  const normalized = value.trim()
  if (!normalized) return Number.NaN
  const isoLike = normalized.includes('T') ? normalized : normalized.replace(' ', 'T')
  return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(isoLike) ? isoLike : `${isoLike}Z`)
}

export function shouldTouchConsoleSession(lastSeenAt: string | null | undefined, now = Date.now()) {
  if (!lastSeenAt) return true
  const lastSeenTimestamp = utcTimestamp(lastSeenAt)
  if (!Number.isFinite(lastSeenTimestamp)) return true
  return now - lastSeenTimestamp >= CONSOLE_SESSION_TOUCH_INTERVAL_MS
}
