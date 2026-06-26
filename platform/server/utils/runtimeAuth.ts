import type { H3Event } from 'h3'
import { getHeader, getMethod, getQuery, readBody } from 'h3'
import { normalizeNullableString } from '~~/server/utils/api'
import { findDeploymentByCode, type TenantScopedDeploymentRow } from '~~/server/utils/platform'
import { verifyRuntimeToken, type RuntimeCredentialSnapshot } from '~~/server/utils/runtimeToken'

const V1_RUNTIME_AUTH_PREFIXES = [
  '/api/v1/runtime/',
  '/api/v1/policy/',
  '/api/v1/revocations/',
  '/api/v1/registry/'
]

export type RuntimeAccessContext = {
  tenantCode: string
  deployment: TenantScopedDeploymentRow | null
  credential: RuntimeCredentialSnapshot
}

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function extractBearerToken(event: H3Event) {
  const authorization = normalizeString(getHeader(event, 'authorization'))
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim()
  }

  return ''
}

function shouldReadBody(event: H3Event) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(getMethod(event).toUpperCase())
}

async function readRuntimeBody(event: H3Event) {
  if (!shouldReadBody(event)) {
    return null
  }

  return await readBody<Record<string, unknown> | null>(event).catch(() => null)
}

function deploymentCodeFromPath(path: string) {
  const match = path.match(/^\/api\/(?:platform\/runtime|v1\/runtime)\/deployments\/([^/]+)/)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

function extractTenantCodeFromBody(body: Record<string, unknown> | null) {
  return normalizeNullableString(body?.tenantCode || body?.tenant_code)
}

function extractDeploymentCodeFromBody(body: Record<string, unknown> | null) {
  return normalizeNullableString(body?.deploymentId || body?.deploymentCode || body?.deployment_code)
}

export function isRuntimeContractPath(path: string) {
  return V1_RUNTIME_AUTH_PREFIXES.some(prefix => path.startsWith(prefix))
}

export async function requireRuntimeAccess(event: H3Event, path: string): Promise<RuntimeAccessContext> {
  const token = extractBearerToken(event)
  if (!token) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'runtime token is required'
    })
  }

  const query = getQuery(event)
  const body = await readRuntimeBody(event)
  const queryTenantCode = normalizeNullableString(query.tenantCode || query.tenant_code)
  const bodyTenantCode = extractTenantCodeFromBody(body)
  const tenantCode = queryTenantCode || bodyTenantCode
  const deploymentCode = deploymentCodeFromPath(path)
    || normalizeNullableString(query.deploymentId || query.deploymentCode || query.deployment_code)
    || extractDeploymentCodeFromBody(body)

  if (queryTenantCode && bodyTenantCode && queryTenantCode !== bodyTenantCode) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: `tenant context mismatch: ${queryTenantCode} !== ${bodyTenantCode}`
    })
  }

  if (deploymentCode) {
    const deployment = await findDeploymentByCode(deploymentCode, tenantCode)
    const credential = await verifyRuntimeToken({
      tenantCode: deployment.tenant_code,
      token
    })
    const context = {
      tenantCode: deployment.tenant_code,
      deployment,
      credential
    }

    event.context.platformRuntime = context
    event.context.deployment = deployment
    event.context.platformTenantCode = deployment.tenant_code
    return context
  }

  if (!tenantCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'deploymentId or tenantCode is required for runtime access'
    })
  }

  const credential = await verifyRuntimeToken({
    tenantCode,
    token
  })
  const context = {
    tenantCode,
    deployment: null,
    credential
  }

  event.context.platformRuntime = context
  event.context.platformTenantCode = tenantCode
  return context
}
