import type { H3Event } from 'h3'
import {
  getDirectoryUserByUid,
  listDirectoryDepartments,
  type DirectoryDepartment
} from '~~/server/utils/directoryRuntimeClient'

interface DeptInfo {
  id: number
  name: string
  dept_code: string
  org_type: string
  manager_uid: string | null
  leader_uid: string | null
  parent_code: string | null
  level: number
}

function getDeptByCode(departments: DirectoryDepartment[], deptCode: string): DeptInfo | null {
  const department = departments.find(item => item.deptCode === deptCode)
  if (!department) return null

  return {
    id: department.id || 0,
    name: department.name,
    dept_code: department.deptCode,
    org_type: department.orgType || 'department',
    manager_uid: department.managerId || null,
    leader_uid: department.leaderId || null,
    parent_code: department.parentId || null,
    level: department.level || 0
  }
}

async function getUserRoles(uid: string): Promise<string[]> {
  console.warn(`[WorkflowInitiatorContext] User role context for ${uid} requires request-scoped Console authorization and no longer reads local policy bundle`)
  return []
}

export async function collectWorkflowInitiatorContext(event: H3Event, uid: string): Promise<Record<string, unknown>> {
  const context: Record<string, unknown> = {
    initiator_uid: uid
  }

  const user = await getDirectoryUserByUid(event, uid)
  if (user) {
    context.initiator_name = user.realName || user.displayName || user.nickname || uid
    if (user.deptCode) {
      context.dept_code = user.deptCode
      context.initiator_dept_code = user.deptCode
      context.dept_name = user.deptName

      const departments = await listDirectoryDepartments(event)
      const dept = getDeptByCode(departments, user.deptCode)
      if (dept) {
        context.dept_org_type = dept.org_type
        context.dept_level = dept.level
        context.initiator_dept_manager_uid = dept.manager_uid
        context.initiator_dept_leader_uid = dept.leader_uid
        context.initiator_dept_parent_code = dept.parent_code
        context.dept_manager_uid = dept.manager_uid
        context.dept_leader_uid = dept.leader_uid

        if (dept.parent_code) {
          const parentDept = getDeptByCode(departments, dept.parent_code)
          context.initiator_dept_parent_manager_uid = parentDept?.manager_uid || null
          context.initiator_dept_parent_leader_uid = parentDept?.leader_uid || null
        }
      }
    }
  }

  const roles = await getUserRoles(uid)
  context.initiator_roles = roles
  if (roles.length > 0) {
    context.initiator_role = roles
  }

  return context
}
