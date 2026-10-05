import {
  fetchDirectoryDepartmentMembersByService,
  fetchDirectoryDepartmentsByService
} from '../../utils/directoryService'
import { requireRequestUid } from '../../utils/authIdentity'

export default defineEventHandler(async (event) => {
  requireRequestUid(event)
  const query = getQuery(event)
  const deptCode = query.deptCode as string

  if (!deptCode) {
    throw createError({ statusCode: 400, message: '缺少 deptCode' })
  }

  try {
    const [departmentsResponse, membersResponse] = await Promise.all([
      fetchDirectoryDepartmentsByService(event),
      fetchDirectoryDepartmentMembersByService(event, deptCode, getQuery(event) as Record<string, unknown>)
    ])

    const departments = departmentsResponse.data.flat || []
    const dept = departments.find(item => item.deptCode === deptCode)
    const membersData = membersResponse.data

    const parentDept = dept?.parentId
      ? departments.find(item => item.deptCode === dept.parentId) || null
      : null
    const members = Array.isArray(membersData?.items) ? membersData.items : []

    let managerName: string | null = null
    if (dept?.managerId) {
      const found = members.find(m => m.uid === dept.managerId)
      managerName = found?.realName || dept.manager || dept.managerId
    }

    return {
      code: 0,
      data: {
        managerId: dept?.managerId || null,
        managerName,
        leaderId: dept?.leaderId || null,
        parentManagerId: parentDept?.managerId || null,
        parentLeaderId: parentDept?.leaderId || null,
        members: members.map(m => ({
          uid: m.uid,
          realName: m.realName || m.uid
        }))
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[DepartmentMembers] Error:', msg)
    throw createError({ statusCode: 500, message: '获取部门成员失败' })
  }
})
