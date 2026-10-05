type TokenClaims = Record<string, unknown>

const text = (value: unknown) => String(value || '').trim()
const record = (value: unknown): TokenClaims => value && typeof value === 'object' && !Array.isArray(value) ? value as TokenClaims : {}

export function serviceCommandSourceClientId(claims: TokenClaims) {
  const clientCode = text(record(claims.hzy).clientCode)
  if (clientCode) return clientCode
  const clientId = text(claims.client_id)
  if (clientId) return clientId.replace(/^client:/, '')
  return text(claims.sub).replace(/^client:/, '')
}
