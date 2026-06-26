import { fetchDirectoryData } from '../../utils/directoryCompat'
import type { Department } from '~/types/account'

interface DepartmentMembersData {
  items: unknown[]
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const deptCode = query.deptCode as string

  if (!deptCode) {
    throw createError({ statusCode: 400, message: '缺少 deptCode' })
  }

  try {
    const dept = await fetchDirectoryData<Department>(`/departments/${encodeURIComponent(deptCode)}`)

    if (!dept) {
      return { code: 0, data: { orgType: null, deptCategory: null, memberCount: 0 } }
    }

    let memberCount = 0
    try {
      const membersRes = await fetchDirectoryData<DepartmentMembersData>(`/departments/${encodeURIComponent(dept.deptCode)}/members`, {
        params: getQuery(event) as Record<string, unknown>
      })
      memberCount = Number(membersRes.total || membersRes.items?.length || 0)
    } catch (e) {
      console.warn('[DepartmentInfo] Failed to fetch members:', e)
    }

    return {
      code: 0,
      data: {
        deptCode: dept.deptCode,
        name: dept.name,
        orgType: dept.orgType || null,
        deptCategory: dept.deptCategory ?? null,
        managerId: dept.managerId || null,
        leaderId: dept.leaderId || null,
        parentId: dept.parentId || null,
        memberCount
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[DepartmentInfo] Error:', msg)
    throw createError({
      statusCode: 500,
      message: '获取部门信息失败'
    })
  }
})
