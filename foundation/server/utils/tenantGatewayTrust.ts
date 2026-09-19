import { createError, getHeader, type H3Event } from 'h3'
import { isPositiveUint64Decimal } from '../../shared/utils/unsignedDecimal'

type RuntimeConfigRecord = Record<string, unknown>
type CloudflareEnv = Record<string, unknown>

type CloudflareRuntimeEvent = H3Event & {
  context?: H3Event['context'] & {
    cloudflare?: { env?: CloudflareEnv }
    _platform?: { cloudflare?: { env?: CloudflareEnv } }
  }
  req?: { runtime?: { cloudflare?: { env?: CloudflareEnv } } }
}

export interface TrustedTenantGatewayContext {
  tenant: string
  deployment: string
  environment: string
  appCode: string
  forwardedHost: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function configValue(config: RuntimeConfigRecord, keys: string[]) {
  for (const key of keys) {
    let current: unknown = config
    for (const part of key.split('.')) {
      if (!current || typeof current !== 'object') {
        current = undefined
        break
      }
      current = (current as RuntimeConfigRecord)[part]
    }
    const value = text(current)
    if (value) return value
  }
  return ''
}

function cloudflareEnv(event: H3Event): CloudflareEnv {
  const runtimeEvent = event as CloudflareRuntimeEvent
  return runtimeEvent.context?.cloudflare?.env
    || runtimeEvent.context?._platform?.cloudflare?.env
    || runtimeEvent.req?.runtime?.cloudflare?.env
    || {}
}

function envValue(event: H3Event, names: string[]) {
  const cfEnv = cloudflareEnv(event)
  for (const name of names) {
    const value = text(cfEnv[name])
    if (value) return value
  }
  for (const name of names) {
    const value = text(process.env[name])
    if (value) return value
  }
  return ''
}

function constantTimeEquals(left: string, right: string) {
  let diff = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return diff === 0
}

function gatewayToken(event: H3Event, config: RuntimeConfigRecord) {
  return configValue(config, [
    'hzy.cloudflareInternalToken',
    'hzy.tenantGateway.internalToken',
    'tenantGateway.internalToken',
    'security.cloudflareInternalToken',
    'security.tenantGatewayInternalToken'
  ]) || envValue(event, [
    'HZY_CLOUDFLARE_INTERNAL_TOKEN',
    'HZY_TENANT_GATEWAY_INTERNAL_TOKEN',
    'HZY_CONSOLE_TENANT_GATEWAY_TOKEN',
    'TENANT_GATEWAY_INTERNAL_TOKEN'
  ])
}

export function resolveTrustedTenantGatewayContext(
  event: H3Event,
  config = useRuntimeConfig(event) as unknown as RuntimeConfigRecord
): TrustedTenantGatewayContext | null {
  if (text(getHeader(event, 'x-hzy-gateway')) !== 'tenant-gateway') return null
  const expected = gatewayToken(event, config)
  if (!expected || !constantTimeEquals(text(getHeader(event, 'x-hzy-gateway-token')), expected)) return null
  return {
    tenant: text(getHeader(event, 'x-hzy-tenant')),
    deployment: text(getHeader(event, 'x-hzy-deployment')),
    environment: text(getHeader(event, 'x-hzy-environment')),
    appCode: text(getHeader(event, 'x-hzy-app-code')),
    forwardedHost: text(getHeader(event, 'x-forwarded-host')).split(',')[0]?.trim() || ''
  }
}

function schedulerCanonical(input: {
  path: string
  requestId: string
  tenant: string
  deployment: string
  appCode: string
  environment: string
  runtimeEndpoint: string
  forwardedHost: string
  consoleTargetDeployment: string
  issuedAt: string
  schedulerStorage: string
  schedulerGeneration: string
}) {
  const values = [
    'POST',
    input.path,
    input.requestId,
    input.tenant,
    input.deployment,
    input.appCode,
    input.environment,
    input.runtimeEndpoint,
    input.forwardedHost
  ]
  if (input.appCode === 'people') values.push(input.consoleTargetDeployment)
  if (input.schedulerStorage) values.push('enterprise-scheduler-v1', input.schedulerStorage, input.schedulerGeneration)
  values.push(input.issuedAt)
  return values.join('\n')
}

async function hmacHex(secret: string, value: string) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function requireTenantGatewaySchedulerRequest(event: H3Event, expectedAppCode: string, path = '/api/internal/integration-operations/drain') {
  const config = useRuntimeConfig(event) as unknown as RuntimeConfigRecord
  const context = resolveTrustedTenantGatewayContext(event, config)
  const schedulerKind = text(getHeader(event, 'x-hzy-scheduler'))
  const requestId = text(getHeader(event, 'x-request-id'))
  const runtimeEndpoint = text(getHeader(event, 'x-hzy-data-runtime-url') || getHeader(event, 'x-hzy-tenant-runtime-url'))
  const consoleTargetDeployment = text(getHeader(event, 'x-hzy-console-target-deployment'))
  const issuedAt = text(getHeader(event, 'x-hzy-scheduler-issued-at'))
  const signature = text(getHeader(event, 'x-hzy-scheduler-signature'))
  const schedulerStorage = text(getHeader(event, 'x-hzy-scheduler-storage'))
  const schedulerGeneration = text(getHeader(event, 'x-hzy-scheduler-generation'))
  if ((schedulerStorage || schedulerGeneration)
    && (!['aims', 'assets'].includes(expectedAppCode) || !['unified', 'recovered', 'disabled'].includes(schedulerStorage) || !isPositiveUint64Decimal(schedulerGeneration))) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'scheduler storage binding invalid' })
  }
  if (
    !context
    || schedulerKind !== 'tenant-gateway'
    || context.appCode !== expectedAppCode
    || !context.tenant
    || !context.deployment
    || !context.environment
    || !context.forwardedHost
    || !requestId
    || !runtimeEndpoint
    || !issuedAt
    || !signature
  ) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  const issuedAtMs = Number(issuedAt)
  if (!Number.isSafeInteger(issuedAtMs) || Math.abs(Date.now() - issuedAtMs) > 60_000) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'scheduler wake expired' })
  }
  const expectedSignature = await hmacHex(gatewayToken(event, config), schedulerCanonical({
    path,
    requestId,
    tenant: context.tenant,
    deployment: context.deployment,
    appCode: context.appCode,
    environment: context.environment,
    runtimeEndpoint,
    forwardedHost: context.forwardedHost,
    consoleTargetDeployment,
    schedulerStorage,
    schedulerGeneration,
    issuedAt
  }))
  if (!constantTimeEquals(signature, expectedSignature)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'scheduler wake signature invalid' })
  }
  return { ...context, requestId, runtimeEndpoint, consoleTargetDeployment, schedulerStorage, schedulerGeneration }
}
