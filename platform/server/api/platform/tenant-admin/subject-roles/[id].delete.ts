import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { withTransaction } from '~~/server/utils/db'
import { bumpRoleHolderRevision, lockRoleAssignmentConstraint } from '~~/server/utils/roleAssignmentConstraints'
import { requireTenantOwnerForTenantAdmin } from '~~/server/utils/tenantAdminAccess'

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
  requireTenantOwnerForTenantAdmin(event, 'only tenant owner can revoke subject roles')
  const tenantCode = String(event.context.platformTenantCode || '').trim()
  if (!tenantCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'tenant context is missing'
    })
  }

  const result = await withTransaction(async (tx) => {
    const assignment = await tx.queryRow<AssignmentRow>(
      `SELECT id, tenant_code, subject_id, role_id, expired_at, status
       FROM tenant_subject_roles
       WHERE id = ?
         AND tenant_code = ?
       LIMIT 1
       FOR UPDATE`,
      [id, tenantCode]
    )

    if (!assignment) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: `subject role assignment not found: id=${id}`
      })
    }

    await lockRoleAssignmentConstraint(tx, tenantCode, assignment.role_id)
    await tx.execute<ResultSetHeader>(
      `UPDATE tenant_subject_roles
       SET status = 'revoked',
           expired_at = UTC_TIMESTAMP()
       WHERE id = ?
         AND tenant_code = ?`,
      [id, tenantCode]
    )

    const revision = assignment.status === 'active'
      ? await bumpRoleHolderRevision(tx, tenantCode, assignment.role_id)
      : 0

    return { assignment, revision }
  })

  return ok({
    id,
    tenantCode,
    subjectId: result.assignment.subject_id,
    roleId: result.assignment.role_id,
    roleHolderRevision: result.revision,
    revoked: true
  })
})
