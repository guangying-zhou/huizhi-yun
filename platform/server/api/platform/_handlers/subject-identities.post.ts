import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { queryRow, withTransaction } from '~~/server/utils/db'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'

interface SubjectIdentityRow extends RowDataPacket {
  id: number
  tenant_code: string
  subject_id: number
  provider_type: string
  provider_code: string
  provider_subject_key: string
  provider_metadata_json: unknown
  status: string
  created_at: string
  updated_at: string
}

const ALLOWED_STATUSES = new Set(['active', 'disabled'])

function requireAllowed(value: string, field: string, allowed: Set<string>) {
  if (!allowed.has(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `${field} must be one of: ${Array.from(allowed).join(', ')}`
    })
  }

  return value
}

function parseMetadata(value: unknown) {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }

  return value
}

async function loadIdentity(id: number) {
  return queryRow<SubjectIdentityRow>(
    `SELECT tsi.id, tsi.tenant_code, tsi.subject_id,
            tip.provider_type, tip.provider_code,
            tsi.provider_subject_key, tsi.provider_metadata_json,
            tsi.status, tsi.created_at, tsi.updated_at
     FROM tenant_subject_identities tsi
     INNER JOIN tenant_identity_providers tip
       ON tip.id = tsi.provider_id
      AND tip.tenant_code = tsi.tenant_code
     WHERE tsi.id = ?`,
    [id]
  )
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)

  const tenantCodeFromBody = normalizeNullableString(body.tenantCode)
  const subjectId = Number(body.subjectId)
  const providerType = requireString(body.providerType, 'providerType')
  const providerSubjectKey = requireString(body.providerSubjectKey, 'providerSubjectKey')
  const status = requireAllowed(normalizeNullableString(body.status) || 'active', 'status', ALLOWED_STATUSES)
  const providerMetadata = body.providerMetadata === undefined || body.providerMetadata === null
    ? null
    : JSON.stringify(body.providerMetadata)

  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'subjectId is invalid'
    })
  }

  const identityId = await withTransaction(async (tx) => {
    const subject = await tx.queryRow<RowDataPacket & { tenant_code: string }>(
      `SELECT id, tenant_code
       FROM tenant_subjects
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [subjectId]
    )

    if (!subject) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: `subject not found: subjectId=${subjectId}`
      })
    }

    if (tenantCodeFromBody && tenantCodeFromBody !== subject.tenant_code) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: `tenantCode mismatch: tenantCode=${tenantCodeFromBody}, subjectTenantCode=${subject.tenant_code}`
      })
    }

    let provider = await tx.queryRow<RowDataPacket & { id: number, provider_code: string }>(
      `SELECT id, provider_code
       FROM tenant_identity_providers
       WHERE tenant_code = ?
         AND provider_type = ?
       ORDER BY id ASC
       LIMIT 1`,
      [subject.tenant_code, providerType]
    )

    if (!provider) {
      const defaultProviderCode = providerType
      const existingCode = await tx.queryRow<RowDataPacket & { id: number, provider_code: string }>(
        `SELECT id, provider_code
         FROM tenant_identity_providers
         WHERE tenant_code = ?
           AND provider_code = ?
         LIMIT 1`,
        [subject.tenant_code, defaultProviderCode]
      )

      if (existingCode) {
        provider = existingCode
      } else {
        const providerResult = await tx.execute<ResultSetHeader>(
          `INSERT INTO tenant_identity_providers
            (tenant_code, provider_code, provider_type, provider_name, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', NOW(), NOW())`,
          [subject.tenant_code, defaultProviderCode, providerType, providerType]
        )

        provider = {
          id: providerResult.insertId,
          provider_code: defaultProviderCode
        } as RowDataPacket & { id: number, provider_code: string }
      }
    }

    const existing = await tx.queryRow<RowDataPacket>(
      `SELECT id
       FROM tenant_subject_identities
       WHERE tenant_code = ?
         AND provider_id = ?
         AND provider_subject_key = ?
       LIMIT 1`,
      [subject.tenant_code, provider.id, providerSubjectKey]
    )

    if (existing) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: `subject identity already exists: providerType=${providerType}, providerSubjectKey=${providerSubjectKey}`
      })
    }

    const result = await tx.execute<ResultSetHeader>(
      `INSERT INTO tenant_subject_identities
        (tenant_code, subject_id, provider_id, provider_subject_key, provider_metadata_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [subject.tenant_code, subjectId, provider.id, providerSubjectKey, providerMetadata, status]
    )

    return result.insertId
  })

  const identity = await loadIdentity(identityId)
  if (!identity) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to load created subject identity'
    })
  }

  return ok({
    id: identity.id,
    tenantCode: identity.tenant_code,
    subjectId: identity.subject_id,
    providerType: identity.provider_type,
    providerCode: identity.provider_code,
    providerSubjectKey: identity.provider_subject_key,
    providerMetadata: parseMetadata(identity.provider_metadata_json),
    status: identity.status,
    createdAt: identity.created_at,
    updatedAt: identity.updated_at
  })
})
