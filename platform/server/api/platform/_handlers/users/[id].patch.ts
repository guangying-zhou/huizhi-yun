import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow } from '~~/server/utils/db'
import { normalizeNullableString, ok } from '~~/server/utils/api'

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
  const id = requireId(event)
  const body = await readBody<Record<string, unknown>>(event)
  const existing = await loadUser(id)

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `user not found: id=${id}`
    })
  }

  const subjectUpdates: string[] = []
  const subjectParams: Array<string | number | null> = []

  const displayName = body.displayName !== undefined ? String(body.displayName || '').trim() : null
  const username = body.username !== undefined ? normalizeNullableString(body.username) : null

  if (body.displayName !== undefined && !displayName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'displayName is required'
    })
  }

  if (body.status !== undefined) {
    subjectUpdates.push('status = ?')
    subjectParams.push(requireAllowed(String(body.status), 'status', ALLOWED_STATUSES))
  }

  if (body.displayName !== undefined) {
    subjectUpdates.push('display_name = ?')
    subjectParams.push(displayName)
  }

  if (body.username !== undefined) {
    subjectUpdates.push('external_ref = ?')
    subjectParams.push(username)
  }

  if (subjectUpdates.length === 0 && body.sourceType === undefined && body.lastLoginAt === undefined) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'no updatable fields provided'
    })
  }

  if (subjectUpdates.length > 0) {
    await execute<ResultSetHeader>(
      `UPDATE tenant_subjects
       SET ${subjectUpdates.join(', ')}, updated_at = NOW()
       WHERE id = ?`,
      [...subjectParams, id]
    )
  }

  const user = await loadUser(id)
  if (!user) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to load updated user'
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
