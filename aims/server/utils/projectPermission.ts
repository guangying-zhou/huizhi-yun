import type { H3Event } from 'h3'
import type { RowDataPacket } from '~~/server/utils/db'
import { checkPermission } from '~~/server/utils/checkPermission'
import { queryRow } from '~~/server/utils/db'

interface ProjectMemberRow extends RowDataPacket {
  uid: string
  role: string
}

export async function requireAuthenticatedUid(event: H3Event) {
  return requireRequestUid(event)
}

export async function getProjectMember(projectId: number, uid: string) {
  return queryRow<ProjectMemberRow>(
    'SELECT uid, role FROM aims_project_members WHERE project_id = ? AND uid = ? AND status = \'active\'',
    [projectId, uid]
  )
}

export async function hasGlobalProjectAdmin(event: H3Event) {
  return await checkPermission(event, 'projects', 'admin')
}

export async function requireGlobalProjectAdmin(
  event: H3Event,
  message = '仅系统管理员可以执行该操作'
) {
  const uid = await requireAuthenticatedUid(event)
  if (await hasGlobalProjectAdmin(event)) {
    return { uid }
  }
  throw createError({ statusCode: 403, message })
}

export async function requireProjectMember(
  event: H3Event,
  projectId: number,
  message = '当前用户不是项目成员'
) {
  const uid = await requireAuthenticatedUid(event)
  const member = await getProjectMember(projectId, uid)
  if (member) {
    return { uid, member }
  }

  if (await hasGlobalProjectAdmin(event)) {
    return {
      uid,
      member: {
        uid,
        role: 'manager'
      } as ProjectMemberRow
    }
  }

  throw createError({ statusCode: 403, message })
}

export async function canAccessProject(event: H3Event, projectId: number, uid: string) {
  const member = await getProjectMember(projectId, uid)
  if (member) {
    return {
      canAccess: true,
      role: member.role
    }
  }

  if (await hasGlobalProjectAdmin(event)) {
    return {
      canAccess: true,
      role: 'manager'
    }
  }

  return {
    canAccess: false,
    role: null
  }
}

export async function requireProjectManager(
  event: H3Event,
  projectId: number,
  message = '仅项目经理可以执行该操作'
) {
  const { uid, member } = await requireProjectMember(event, projectId, message)
  if (member.role !== 'manager') {
    throw createError({ statusCode: 403, message })
  }
  return { uid, member }
}
