import { fetchDirectoryData } from '../../utils/directoryCompat'
import type { AccountUser, Department } from '~/types/account'

interface DepartmentMembersData {
  items: AccountUser[]
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const deptCode = query.deptCode as string

  if (!deptCode) {
    throw createError({ statusCode: 400, message: '缺少 deptCode' })
  }

  try {
    const [dept, membersData] = await Promise.all([
      fetchDirectoryData<Department>(`/departments/${encodeURIComponent(deptCode)}`),
      fetchDirectoryData<DepartmentMembersData>(`/departments/${encodeURIComponent(deptCode)}/members`, {
        params: getQuery(event) as Record<string, unknown>
      })
    ])

    const parentDept = dept?.parentId
      ? await fetchDirectoryData<Department>(`/departments/${encodeURIComponent(dept.parentId)}`)
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
