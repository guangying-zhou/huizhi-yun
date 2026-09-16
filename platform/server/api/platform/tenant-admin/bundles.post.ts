import { normalizeNullableString, ok } from '~~/server/utils/api'
import { generatePolicyBundle, redactPolicyBundlePayloadForResponse } from '~~/server/utils/policyBundle'
import { normalizeDeploymentEnvironment } from '~~/server/utils/tenantDeploymentSettings'

const POLICY_BUNDLE_V2_MIGRATION_MESSAGE = 'Platform database schema is missing Policy Bundle v2 migrations. Run platform/docs/sql/HZY-Platform-SQL-Migration-v2.24-policy-bundle-v2-repair.sql, then retry.'

function isPolicyBundleSchemaDriftError(error: unknown) {
  const err = error as { code?: string, errno?: number, message?: string }
  const message = String(err?.message || '')
  const isMissingTable = err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146
  const isMissingColumn = err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054 || message.includes('Unknown column')
  return (
    isMissingTable
    && message.includes('tenant_policy_revisions')
  ) || (
    isMissingColumn
    && (
      message.includes('policy_revision')
      || message.includes('policy_hash')
      || message.includes('schema_version')
      || message.includes('issued_at')
      || message.includes('expires_at')
    )
  )
}

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
  }).catch((error) => {
    if (!isPolicyBundleSchemaDriftError(error)) {
      throw error
    }

    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: POLICY_BUNDLE_V2_MIGRATION_MESSAGE
    })
  })

  return ok({
    tenantCode: generated.tenantCode,
    environment: generated.environment,
    bundleId: generated.bundleId,
    bundleVersion: generated.bundleVersion,
    bundleHash: generated.bundleHash,
    policyRevision: generated.policyRevision,
    policyHash: generated.policyHash,
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
