export const GATEWAY_EXCHANGE_PATH: '/v1/console/auth/service-tokens/gateway-exchange'
export const GATEWAY_ASSERTION_TYPE: 'hzy-gateway-service-assertion+jwt'
export function canonicalGatewayScope(value: string): string
export function gatewayExchangeAllowsLegacy(status: number, code: unknown): boolean
export function gatewayExchangeWithLegacy<T>(
  exchange: () => Promise<{ status: number, code?: unknown, result?: T }>,
  legacy: () => Promise<T>
): Promise<T>
