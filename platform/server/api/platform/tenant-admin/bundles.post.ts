import { normalizeNullableString, ok } from '~~/server/utils/api'
import { generatePolicyBundle, redactPolicyBundlePayloadForResponse } from '~~/server/utils/policyBundle'
import { normalizeDeploymentEnvironment } from '~~/server/utils/tenantDeploymentSettings'

function normalizeSqlDateTime(value: unknown) {
  const rawValue = normalizeNullableString(value)
  if (!rawValue) {
    return null
  }

  const date = new Date(rawValue.includes('T') ? rawValue : `${rawValue.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'expiresAt must be a valid datetime'
    })
  }

  return date.toISOString().slice(0, 19).replace('T', ' ')
}

export default defineEventHandler(async (event) => {
  const tenantCode = String(event.context.platformTenantCode || '').trim()
  const membership = event.context.platformTenantMembership
  if (!tenantCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'tenant context is missing'
    })
  }

  if (!membership?.isOwner) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'only tenant owner can generate policy bundles'
    })
  }

  const body = await readBody<Record<string, unknown> | null>(event).catch(() => null)
  const environment = normalizeDeploymentEnvironment(body?.environment || getQuery(event).environment)
  const expiresAt = normalizeSqlDateTime(body?.expiresAt)
  const includePayload = body?.includePayload === true
  const generated = await generatePolicyBundle({
    tenantCode,
    environment,
    platformBaseUrl: normalizeNullableString(body?.platformBaseUrl),
    expiresAt
  })

  return ok({
    tenantCode: generated.tenantCode,
    environment: generated.environment,
    bundleId: generated.bundleId,
    bundleVersion: generated.bundleVersion,
    bundleHash: generated.bundleHash,
    bundleUri: generated.bundleUri,
    schemaVersion: generated.schemaVersion,
    signature: generated.signature,
    kid: generated.signedByKid,
    signedByKid: generated.signedByKid,
    alg: generated.alg,
    signedAt: generated.signedAt,
    issuedAt: generated.issuedAt,
    expiresAt: generated.expiresAt,
    targetCount: generated.targets.length,
    targets: generated.targets,
    payload: includePayload ? redactPolicyBundlePayloadForResponse(generated.payload) : undefined
  })
})
