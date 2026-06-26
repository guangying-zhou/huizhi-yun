import type { H3Event } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface SubjectRow extends RowDataPacket {
  id: number
  tenant_code: string
}

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

function requireId(event: H3Event) {
  const raw = getRouterParam(event, 'id')
  const id = Number(raw)
  if (!raw || Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'id is invalid'
    })
  }

  return id
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

export default defineEventHandler(async (event) => {
  const id = requireId(event)

  const subject = await queryRow<SubjectRow>(
    `SELECT id, tenant_code
     FROM tenant_subjects
     WHERE id = ?
     LIMIT 1`,
    [id]
  )

  if (!subject) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `tenant subject not found: id=${id}`
    })
  }

  const items = await queryRows<SubjectIdentityRow[]>(
    `SELECT tsi.id, tsi.tenant_code, tsi.subject_id,
            tip.provider_type, tip.provider_code,
            tsi.provider_subject_key, tsi.provider_metadata_json,
            tsi.status, tsi.created_at, tsi.updated_at
     FROM tenant_subject_identities tsi
     INNER JOIN tenant_identity_providers tip
       ON tip.id = tsi.provider_id
      AND tip.tenant_code = tsi.tenant_code
     WHERE tsi.subject_id = ?
       AND tsi.tenant_code = ?
     ORDER BY tip.provider_type ASC, tsi.id ASC`,
    [id, subject.tenant_code]
  )

  return ok(items.map(item => ({
    id: item.id,
    tenantCode: item.tenant_code,
    subjectId: item.subject_id,
    providerType: item.provider_type,
    providerCode: item.provider_code,
    providerSubjectKey: item.provider_subject_key,
    providerMetadata: parseMetadata(item.provider_metadata_json),
    status: item.status,
    createdAt: item.created_at,
    updatedAt: item.updated_at
  })))
})
