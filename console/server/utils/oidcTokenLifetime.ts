export const MIN_REFRESH_TOKEN_TTL_SECONDS = 60

export function clampRefreshTokenTtlSeconds(
  configuredTtlSeconds: number,
  sessionExpiresAt: string,
  nowMs = Date.now()
) {
  const configured = Math.floor(Number(configuredTtlSeconds))
  const expiresAtMs = Date.parse(String(sessionExpiresAt || ''))
  if (!Number.isFinite(configured) || configured <= 0 || !Number.isFinite(expiresAtMs)) {
    return 0
  }

  const remainingSessionSeconds = Math.floor((expiresAtMs - nowMs) / 1000)
  const boundedTtl = Math.min(configured, remainingSessionSeconds)
  return boundedTtl >= MIN_REFRESH_TOKEN_TTL_SECONDS ? boundedTtl : 0
}
