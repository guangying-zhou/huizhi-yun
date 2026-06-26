import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { execute, queryRow } from '~~/server/utils/db'

interface AssignmentRow extends RowDataPacket {
  id: number
  tenant_code: string
  subject_id: number
  role_id: number
  expired_at: string | null
  status: string
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

export default defineEventHandler(async (event) => {
  const id = requireId(event)
  const assignment = await queryRow<AssignmentRow>(
    `SELECT id, tenant_code, subject_id, role_id, expired_at, status
     FROM tenant_subject_roles
     WHERE id = ?
     LIMIT 1`,
    [id]
  )

  if (!assignment) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `subject role assignment not found: id=${id}`
    })
  }

  await execute<ResultSetHeader>(
    `UPDATE tenant_subject_roles
     SET status = 'revoked',
         expired_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [id]
  )

  return ok({
    id,
    tenantCode: assignment.tenant_code,
    subjectId: assignment.subject_id,
    roleId: assignment.role_id,
    revoked: true
  })
})
