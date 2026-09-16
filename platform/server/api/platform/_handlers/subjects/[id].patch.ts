import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow } from '~~/server/utils/db'
import { normalizeNullableString, ok } from '~~/server/utils/api'

interface SubjectRow extends RowDataPacket {
  id: number
  tenant_code: string
  user_id: number | null
  subject_type: string
  subject_code: string
  display_name: string | null
  external_ref: string | null
  parent_subject_id: number | null
  status: string
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

async function loadSubject(id: number) {
  return queryRow<SubjectRow>(
    `SELECT ts.id, ts.tenant_code,
            CASE WHEN ts.subject_type = 'user' THEN ts.id ELSE NULL END AS user_id,
            ts.subject_type, ts.subject_code, ts.display_name, ts.external_ref,
            ts.parent_subject_id, ts.status, ts.created_at, ts.updated_at
     FROM tenant_subjects ts
     WHERE ts.id = ?`,
    [id]
  )
}

export default defineEventHandler(async (event) => {
  const id = requireId(event)
  const body = await readBody<Record<string, unknown>>(event)
  const existing = await loadSubject(id)

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `subject not found: id=${id}`
    })
  }

  const updates: string[] = []
  const params: Array<string | number | null> = []

  if (body.displayName !== undefined) {
    const displayName = String(body.displayName || '').trim()
    if (!displayName) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'displayName is required'
      })
    }
    updates.push('display_name = ?')
    params.push(displayName)
  }

  if (body.externalRef !== undefined) {
    updates.push('external_ref = ?')
    params.push(normalizeNullableString(body.externalRef))
  }

  if (body.status !== undefined) {
    updates.push('status = ?')
    params.push(requireAllowed(String(body.status), 'status', ALLOWED_STATUSES))
  }

  if (body.parentSubjectId !== undefined) {
    const parentSubjectId = body.parentSubjectId === null || body.parentSubjectId === ''
      ? null
      : Number(body.parentSubjectId)

    if (parentSubjectId !== null) {
      if (!Number.isInteger(parentSubjectId) || parentSubjectId <= 0) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Bad Request',
          message: 'parentSubjectId is invalid'
        })
      }

      if (parentSubjectId === id) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Bad Request',
          message: 'parentSubjectId cannot reference the subject itself'
        })
      }

      const parent = await queryRow<RowDataPacket>(
        `SELECT id
         FROM tenant_subjects
         WHERE id = ?
           AND tenant_code = ?
         LIMIT 1`,
        [parentSubjectId, existing.tenant_code]
      )

      if (!parent) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Not Found',
          message: `parent subject not found: parentSubjectId=${parentSubjectId}`
        })
      }
    }

    updates.push('parent_subject_id = ?')
    params.push(parentSubjectId)
  }

  if (updates.length === 0) {
    if (body.userId === undefined) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'no updatable fields provided'
      })
    }

    return ok({
      id: existing.id,
      tenantCode: existing.tenant_code,
      userId: existing.user_id,
      subjectType: existing.subject_type,
      subjectCode: existing.subject_code,
      displayName: existing.display_name || existing.subject_code,
      externalRef: existing.external_ref,
      parentSubjectId: existing.parent_subject_id,
      status: existing.status,
      createdAt: existing.created_at,
      updatedAt: existing.updated_at
    })
  }

  await execute<ResultSetHeader>(
    `UPDATE tenant_subjects
     SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = ?`,
    [...params, id]
  )

  const subject = await loadSubject(id)
  if (!subject) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to load updated subject'
    })
  }

  return ok({
    id: subject.id,
    tenantCode: subject.tenant_code,
    userId: subject.user_id,
    subjectType: subject.subject_type,
    subjectCode: subject.subject_code,
    displayName: subject.display_name || subject.subject_code,
    externalRef: subject.external_ref,
    parentSubjectId: subject.parent_subject_id,
    status: subject.status,
    createdAt: subject.created_at,
    updatedAt: subject.updated_at
  })
})
