import { createError, getHeader, type H3Event } from 'h3'
import { resolveSelfHostedRuntimeDialEndpoint } from './selfHostedServiceTransport'

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

// Shared local-only guard: callers must verify the Gateway credential first.
export function verifiedLocalTestRuntimeDialEndpoint(event: H3Event, canonicalEndpoint: string, trustedGateway: boolean) {
  const requested = stringValue(getHeader(event, 'x-hzy-local-runtime-dial-url'))
  if (!requested) return canonicalEndpoint
  const appCode = stringValue(getHeader(event, 'x-hzy-app-code'))
  const deployment = stringValue(getHeader(event, 'x-hzy-deployment'))
  if (requested !== 'http://127.0.0.1:18084'
    || canonicalEndpoint !== 'https://hzy-test-runtime.isme.dev'
    || process.env.NODE_ENV !== 'development'
    || (process.env.HZY0_LOCAL_ENTERPRISE !== 'true' && process.env.HZY0_LOCAL_CONSOLE_FACADE !== 'true')
    || !trustedGateway
    || stringValue(getHeader(event, 'x-hzy-data-runtime-url')) !== canonicalEndpoint
    || stringValue(getHeader(event, 'x-hzy-data-runtime-code')) !== 'c000001-test-tenant-runtime'
    || stringValue(getHeader(event, 'x-hzy-tenant')) !== 'C000001'
    || stringValue(getHeader(event, 'x-hzy-environment')) !== 'test'
    || stringValue(getHeader(event, 'x-forwarded-host')) !== 'hzy0.isme.dev'
    || !((appCode === 'console' && deployment === 'wiztek-test-console')
      || (appCode === 'enterprise' && deployment === 'C000001-test-enterprise')
      || (appCode === 'collab' && deployment === 'C000001-test-collab')
      || (process.env.HZY0_COMPANY_SUMMARY_CODOCS_DELIVERY === 'true'
        && appCode === 'codocs' && deployment === 'C000001-test-codocs')
      || (process.env.HZY0_WORKFLOW_LOCAL_ONLY === 'true'
        && ((appCode === 'aims' && deployment === 'C000001-test-aims')
          || (appCode === 'workflow' && deployment === 'C000001-test-workflow-local'))))) {
    throw createError({ statusCode: 503, message: 'Local Runtime transport binding is invalid.' })
  }
  return requested
}

/**
 * Runtime TCP dial for a canonical endpoint. The hzy0 header path above stays
 * byte-for-byte identical and takes precedence; otherwise the explicit,
 * startup-validated self-hosted mapping (HZY_SELF_HOSTED_RUNTIME_ENDPOINT →
 * HZY_SELF_HOSTED_RUNTIME_DIAL_ORIGIN) replaces only the dial. The canonical
 * endpoint used for bindings, scheduler HMAC and tokens is never changed, and
 * no request header can select the self-hosted dial.
 */
export function resolveRuntimeDialEndpoint(event: H3Event, canonicalEndpoint: string, trustedGateway: boolean) {
  const hzy0Dial = verifiedLocalTestRuntimeDialEndpoint(event, canonicalEndpoint, trustedGateway)
  if (hzy0Dial !== canonicalEndpoint) return hzy0Dial
  return resolveSelfHostedRuntimeDialEndpoint(canonicalEndpoint)
}
