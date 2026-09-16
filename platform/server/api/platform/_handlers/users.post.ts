import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { queryRow, withTransaction } from '~~/server/utils/db'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'

interface UserRow extends RowDataPacket {
  id: number
  tenant_code: string
  uid: string
  display_name: string | null
  external_ref: string | null
  status: string
  source_type: string
  last_login_at: string | null
  created_at: string
  updated_at: string
}

const ALLOWED_STATUSES = new Set(['active', 'suspended', 'disabled'])

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

async function loadUser(id: number) {
  return queryRow<UserRow>(
    `SELECT ts.id, ts.tenant_code, ts.subject_code AS uid,
            ts.display_name, ts.external_ref, ts.status,
            COALESCE((
              SELECT tip.provider_type
              FROM tenant_subject_identities tsi
              INNER JOIN tenant_identity_providers tip
                ON tip.id = tsi.provider_id
               AND tip.tenant_code = tsi.tenant_code
              WHERE tsi.tenant_code = ts.tenant_code
                AND tsi.subject_id = ts.id
                AND tsi.status = 'active'
                AND tip.status = 'active'
              ORDER BY tsi.id ASC
              LIMIT 1
            ), 'manual') AS source_type,
            (
              SELECT MAX(COALESCE(sess.refreshed_at, sess.issued_at))
              FROM tenant_sessions sess
              WHERE sess.tenant_code = ts.tenant_code
                AND sess.subject_id = ts.id
            ) AS last_login_at,
            ts.created_at, ts.updated_at
     FROM tenant_subjects ts
     WHERE ts.id = ?
       AND ts.subject_type = 'user'`,
    [id]
  )
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)

  const tenantCode = requireString(body.tenantCode, 'tenantCode')
  const uid = requireString(body.uid, 'uid')
  const displayName = requireString(body.displayName, 'displayName')
  const username = normalizeNullableString(body.username)
  const status = requireAllowed(normalizeNullableString(body.status) || 'active', 'status', ALLOWED_STATUSES)

  const tenant = await queryRow<RowDataPacket>(
    `SELECT id
     FROM tenants
     WHERE tenant_code = ?
     LIMIT 1`,
    [tenantCode]
  )

  if (!tenant) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `tenant not found: tenantCode=${tenantCode}`
    })
  }

  const result = await withTransaction(async (tx) => {
    const existing = await tx.queryRow<RowDataPacket>(
      `SELECT id
       FROM tenant_subjects
       WHERE tenant_code = ?
         AND subject_type = 'user'
         AND subject_code = ?
       LIMIT 1`,
      [tenantCode, uid]
    )

    if (existing) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: `user already exists: tenantCode=${tenantCode}, uid=${uid}`
      })
    }

    const insertResult = await tx.execute<ResultSetHeader>(
      `INSERT INTO tenant_subjects
        (tenant_code, subject_type, subject_code, display_name, external_ref, status, created_at, updated_at)
       VALUES (?, 'user', ?, ?, ?, ?, NOW(), NOW())`,
      [tenantCode, uid, displayName, username, status]
    )

    return insertResult.insertId
  })

  const user = await loadUser(result)
  if (!user) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to load created user'
    })
  }

  return ok({
    id: user.id,
    tenantCode: user.tenant_code,
    uid: user.uid,
    username: user.external_ref,
    displayName: user.display_name || user.uid,
    email: null,
    mobile: null,
    avatarUrl: null,
    status: user.status,
    sourceType: user.source_type,
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
    updatedAt: user.updated_at
  })
})
