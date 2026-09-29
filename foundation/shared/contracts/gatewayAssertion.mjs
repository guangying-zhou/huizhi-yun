export const GATEWAY_EXCHANGE_PATH = '/v1/console/auth/service-tokens/gateway-exchange'
export const GATEWAY_ASSERTION_TYPE = 'hzy-gateway-service-assertion+jwt'
export function canonicalGatewayScope(value) {
  return [...new Set(value.split(/\s+/).filter(Boolean))].sort().join(' ')
}
export function gatewayExchangeAllowsLegacy(status, code) {
  return status === 503 && code === 'gateway_keyset_unavailable'
}
export async function gatewayExchangeWithLegacy(exchange, legacy) {
  const response = await exchange()
  if (gatewayExchangeAllowsLegacy(response.status, response.code)) return await legacy()
  if (response.status !== 200 || response.result === undefined) throw new Error('gateway_exchange_failed')
  return response.result
}
