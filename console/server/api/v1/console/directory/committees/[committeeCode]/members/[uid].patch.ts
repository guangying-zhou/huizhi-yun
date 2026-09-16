import { saveConsoleDirectoryCommitteeMembers } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import { listDirectoryCommitteeMembers, ok } from '~~/server/utils/directoryRuntime'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'

interface CommitteeMemberBody {
  role?: unknown
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_departments', 'edit', '需要委员会成员编辑权限')
  requireIdempotencyKey(event)

  const committeeCode = getRouterParam(event, 'committeeCode')
  const uid = getRouterParam(event, 'uid')
  if (!committeeCode) throw createError({ statusCode: 400, message: 'committeeCode is required' })
  if (!uid) throw createError({ statusCode: 400, message: 'uid is required' })

  const body = await readBody<CommitteeMemberBody>(event)
  await saveConsoleDirectoryCommitteeMembers(event, committeeCode, {
    members: [{ uid, role: body.role }]
  })

  return ok(await listDirectoryCommitteeMembers(committeeCode, { page: 1, pageSize: 20 }))
})
