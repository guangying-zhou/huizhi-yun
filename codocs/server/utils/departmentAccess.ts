import type { H3Event } from 'h3'
import {
  fetchDirectoryDepartmentMembersByService,
  fetchDirectoryDepartmentsByService
} from './directoryService'
import type { Department } from '~/types/account'

export type DepartmentRole
  = 'member'
    | 'dept_manager'
    | 'dept_leader'
    | 'parent_manager'
    | 'parent_leader'
    | 'none'

interface DepartmentMember {
  uid: string
}

interface DepartmentMembersData {
  items?: DepartmentMember[]
  total?: number
}

export interface DepartmentAccessContext {
  dept: Department
  parentDept: Department | null
  role: DepartmentRole
  canRead: boolean
  canWrite: boolean
}

const extractMembers = (response: DepartmentMembersData): DepartmentMember[] => {
  if (Array.isArray(response.items)) return response.items
  return []
}

export async function resolveDepartmentAccess(
  event: H3Event,
  actorUid: string,
  deptCode: string
): Promise<DepartmentAccessContext | null> {
  const normalizedActorUid = String(actorUid || '').trim()
  const normalizedDeptCode = String(deptCode || '').trim()

  if (!normalizedActorUid || !normalizedDeptCode) return null

  const deptRes = (await fetchDirectoryDepartmentsByService(event)).data
  const allDepts = deptRes.flat || []
  const dept = allDepts.find(item => item.deptCode === normalizedDeptCode)
  if (!dept) return null

  const parentDept = dept.parentId
    ? allDepts.find(item => item.deptCode === dept.parentId) || null
    : null

  if (dept.leaderId === normalizedActorUid) {
    return { dept, parentDept, role: 'dept_leader', canRead: true, canWrite: false }
  }

  if (dept.managerId === normalizedActorUid) {
    return { dept, parentDept, role: 'dept_manager', canRead: true, canWrite: true }
  }

  try {
    const membersRes = (await fetchDirectoryDepartmentMembersByService(event, normalizedDeptCode)).data

    const isMember = extractMembers(membersRes).some(member => member.uid === normalizedActorUid)
    if (isMember) {
      return { dept, parentDept, role: 'member', canRead: true, canWrite: true }
    }
  } catch (error) {
    console.warn('[DepartmentAccess] Failed to fetch department members:', error)
  }

  if (parentDept?.managerId === normalizedActorUid) {
    return { dept, parentDept, role: 'parent_manager', canRead: true, canWrite: false }
  }

  if (parentDept?.leaderId === normalizedActorUid) {
    return { dept, parentDept, role: 'parent_leader', canRead: true, canWrite: false }
  }

  return { dept, parentDept, role: 'none', canRead: false, canWrite: false }
}

export async function requireDepartmentReadAccess(event: H3Event, actorUid: string, deptCode: string) {
  const access = await resolveDepartmentAccess(event, actorUid, deptCode)

  if (!access?.canRead) {
    throw createError({
      statusCode: 403,
      message: '无权访问该部门文档'
    })
  }

  return access
}

export async function requireDepartmentWriteAccess(event: H3Event, actorUid: string, deptCode: string) {
  const access = await requireDepartmentReadAccess(event, actorUid, deptCode)

  if (!access.canWrite) {
    throw createError({
      statusCode: 403,
      message: '当前身份仅可查看该部门文档'
    })
  }

  return access
}

export async function requireDepartmentManagerAccess(
  event: H3Event,
  actorUid: string,
  deptCode: string,
  message = '仅部门经理可执行该操作'
) {
  const access = await requireDepartmentReadAccess(event, actorUid, deptCode)

  if (access.role !== 'dept_manager') {
    throw createError({
      statusCode: 403,
      message
    })
  }

  return access
}
