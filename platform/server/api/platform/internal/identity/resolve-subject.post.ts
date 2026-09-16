import type { RowDataPacket } from 'mysql2/promise'
import { ok, requireString } from '~~/server/utils/api'
import { queryRow } from '~~/server/utils/db'
import { parseStoredJson } from '~~/server/utils/platform'

interface IdentityMappingRow extends RowDataPacket {
  tenant_code: string
  tenant_name: string | null
  user_id: number | null
  uid: string | null
  user_status: string | null
  user_source_type: string | null
  user_last_login_at: string | null
  subject_id: number
  subject_type: string
  subject_code: string
  subject_display_name: string | null
  subject_status: string
  identity_metadata: unknown
}

export default defineEventHandler(async (event) => {
  if (event.context.platformAccessScope !== 'internal') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'internal access required'
    })
  }

  const body = await readBody<Record<string, unknown>>(event)
  const providerType = requireString(body.providerType, 'providerType')
  const providerSubjectKey = requireString(body.providerSubjectKey, 'providerSubjectKey')

  const mapping = await queryRow<IdentityMappingRow>(
    `SELECT tsi.tenant_code,
            t.tenant_name,
            CASE WHEN ts.subject_type = 'user' THEN ts.id ELSE NULL END AS user_id,
            CASE WHEN ts.subject_type = 'user' THEN ts.subject_code ELSE NULL END AS uid,
            CASE WHEN ts.subject_type = 'user' THEN ts.status ELSE NULL END AS user_status,
            CASE
              WHEN ts.subject_type = 'user' THEN COALESCE((
                SELECT tip2.provider_type
                FROM tenant_subject_identities tsi2
                INNER JOIN tenant_identity_providers tip2
                  ON tip2.id = tsi2.provider_id
                 AND tip2.tenant_code = tsi2.tenant_code
                WHERE tsi2.tenant_code = ts.tenant_code
                  AND tsi2.subject_id = ts.id
                  AND tsi2.status = 'active'
                  AND tip2.status = 'active'
                ORDER BY tsi2.id ASC
                LIMIT 1
              ), 'manual')
              ELSE NULL
            END AS user_source_type,
            CASE
              WHEN ts.subject_type = 'user' THEN (
                SELECT MAX(COALESCE(sess.refreshed_at, sess.issued_at))
                FROM tenant_sessions sess
                WHERE sess.tenant_code = ts.tenant_code
                  AND sess.subject_id = ts.id
              )
              ELSE NULL
            END AS user_last_login_at,
            ts.id AS subject_id,
            ts.subject_type,
            ts.subject_code,
            ts.display_name AS subject_display_name,
            ts.status AS subject_status,
            tsi.provider_metadata_json AS identity_metadata
     FROM tenant_subject_identities tsi
     INNER JOIN tenant_identity_providers tip
       ON tip.id = tsi.provider_id
      AND tip.tenant_code = tsi.tenant_code
     INNER JOIN tenant_subjects ts
       ON ts.id = tsi.subject_id
      AND ts.tenant_code = tsi.tenant_code
     LEFT JOIN tenants t ON t.tenant_code = tsi.tenant_code
     WHERE tip.provider_type = ?
       AND tsi.provider_subject_key = ?
       AND tip.status = 'active'
       AND tsi.status = 'active'
       AND ts.status = 'active'
     LIMIT 1`,
    [providerType, providerSubjectKey]
  )

  if (!mapping) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `subject identity not found: providerType=${providerType}`
    })
  }

  return ok({
    tenant: {
      tenantCode: mapping.tenant_code,
      tenantName: mapping.tenant_name || mapping.tenant_code
    },
    user: mapping.user_id
      ? {
          id: mapping.user_id,
          uid: mapping.uid,
          displayName: mapping.subject_display_name || mapping.uid,
          sourceType: mapping.user_source_type,
          status: mapping.user_status,
          lastLoginAt: mapping.user_last_login_at
        }
      : null,
    subject: {
      id: mapping.subject_id,
      tenantCode: mapping.tenant_code,
      subjectType: mapping.subject_type,
      subjectCode: mapping.subject_code,
      displayName: mapping.subject_display_name || mapping.subject_code,
      status: mapping.subject_status
    },
    identity: {
      providerType,
      providerSubjectKey,
      providerMetadata: parseStoredJson<Record<string, unknown>>(mapping.identity_metadata)
    }
  })
})
