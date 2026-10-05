import { saveConsoleDirectoryCommitteeMembers } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import type { DirectoryCommitteeMemberInput } from '~~/server/utils/directoryAdmin'
import { listDirectoryCommitteeMembers, ok } from '~~/server/utils/directoryRuntime'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'

interface CommitteeMembersBody {
  memberUids?: unknown
  members?: unknown
  role?: unknown
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_departments', 'edit', '需要委员会成员编辑权限')
  requireIdempotencyKey(event)

  const committeeCode = getRouterParam(event, 'committeeCode')
  if (!committeeCode) throw createError({ statusCode: 400, message: 'committeeCode is required' })

  const body = await readBody<CommitteeMembersBody>(event)
  const members: DirectoryCommitteeMemberInput[] = Array.isArray(body.members)
    ? body.members as DirectoryCommitteeMemberInput[]
    : Array.isArray(body.memberUids)
      ? body.memberUids.map(uid => ({ uid, role: body.role || 'member' }))
      : []

  await saveConsoleDirectoryCommitteeMembers(event, committeeCode, { members: members as unknown[] })
  return ok(await listDirectoryCommitteeMembers(committeeCode, { page: 1, pageSize: 20 }))
})
