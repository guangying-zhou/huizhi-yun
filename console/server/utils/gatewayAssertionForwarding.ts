import { createError, getHeader, type H3Event } from 'h3'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { canonicalGatewayScope, GATEWAY_EXCHANGE_PATH, GATEWAY_ASSERTION_TYPE } from '@hzy/foundation/shared/utils/gatewayAssertionContract'

// Proof-bearing requests must not silently enter the legacy path when Console
// is not yet enabled. Credential-backed or proof-free requests are unchanged.
export function gatewayAssertionLaneEnabled(assertion: string, clientSecret: string, enabled: boolean) {
  if (clientSecret || !assertion) return false
  if (!enabled) throw createError({ statusCode: 503, message: 'gateway_exchange_disabled', data: { code: 'gateway_exchange_disabled' } })
  return true
}

// Console only checks the trusted forwarding context. Runtime is the sole
// cryptographic verifier; neither this function nor body.app_code is authority.
export function checkedGatewayAssertion(event: H3Event, assertion: string, request: { clientId: string, audience: string, scope: string, appCode: string }) {
  const context = resolveTrustedTenantGatewayContext(event)
  if (!context || !context.tenant || !context.environment || !context.deployment || !context.appCode) throw createError({ statusCode: 401, message: 'gateway_exchange_context_invalid' })
  if (request.appCode && request.appCode !== context.appCode) throw createError({ statusCode: 403, message: 'gateway_exchange_request_mismatch' })
  const parts = assertion.split('.')
  if (assertion.length > 16384 || parts.length !== 3) throw createError({ statusCode: 400, message: 'gateway_assertion_invalid' })
  let header: Record<string, unknown>, claims: Record<string, unknown>
  try {
    header = JSON.parse(Buffer.from(parts[0] || '', 'base64url').toString())
    claims = JSON.parse(Buffer.from(parts[1] || '', 'base64url').toString())
  } catch { throw createError({ statusCode: 400, message: 'gateway_assertion_invalid' }) }
  const gatewayDeployment = String(getHeader(event, 'x-hzy-gateway-deployment') || '')
  const runtimeCode = String(getHeader(event, 'x-hzy-data-runtime-code') || '')
  const expected: Record<string, string> = { tenant: context.tenant, environment: context.environment, source_app: context.appCode, source_deployment: context.deployment, gateway_deployment: gatewayDeployment, runtime_code: runtimeCode, client_id: request.clientId, oauth_audience: request.audience, scope: canonicalGatewayScope(request.scope), source_binding: 'trusted-gateway', method: 'POST', path: GATEWAY_EXCHANGE_PATH, aud: GATEWAY_EXCHANGE_PATH, iss: `gateway:${gatewayDeployment}`, sub: `gateway:${gatewayDeployment}` }
  if (!header || !claims || header.alg !== 'EdDSA' || header.typ !== GATEWAY_ASSERTION_TYPE || !gatewayDeployment || !runtimeCode || Object.entries(expected).some(([key, value]) => claims[key] !== value)) throw createError({ statusCode: 403, message: 'gateway_exchange_request_mismatch' })
  return { assertion, clientId: request.clientId, audience: request.audience, scope: expected.scope! }
}
