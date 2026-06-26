import { requirePermission } from '~~/server/utils/checkPermission'
import { replaceDirectoryProjectMembers } from '~~/server/utils/directoryAdmin'
import { listDirectoryProjectMembers, ok } from '~~/server/utils/directoryRuntime'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'

interface ProjectMembersBody {
  projectCode?: unknown
  memberUids?: unknown
  members?: unknown
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_projects', 'edit', '需要项目成员编辑权限')

  const actorUid = await requireConsoleRequestUid(event)
  const body = await readBody<ProjectMembersBody>(event)
  const projectCode = String(body.projectCode || '').trim()
  if (!projectCode) throw createError({ statusCode: 400, message: 'projectCode is required' })

  const members = Array.isArray(body.members)
    ? body.members as Array<{ uid: string, role?: 'owner' | 'admin' | 'member' | 'viewer' }>
    : Array.isArray(body.memberUids)
      ? body.memberUids.map(uid => ({ uid: String(uid || '').trim(), role: 'member' as const }))
      : []

  await replaceDirectoryProjectMembers(projectCode, members, actorUid)
  return ok(await listDirectoryProjectMembers(projectCode, { status: 'active' }))
})
