import { getDirectoryDepartment, listDirectoryDepartmentMembers, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const deptCode = String(query.deptCode || query.dept_code || '').trim()
  if (!deptCode) throw createError({ statusCode: 400, message: '缺少 deptCode' })

  const department = await getDirectoryDepartment(deptCode)
  if (!department) {
    return ok({ orgType: null, deptCategory: null, memberCount: 0 })
  }

  const members = await listDirectoryDepartmentMembers(deptCode, query)
  return ok({
    deptCode: department.deptCode,
    name: department.name,
    orgType: department.orgType || null,
    deptCategory: department.deptCategory ?? null,
    managerId: department.managerId || null,
    leaderId: department.leaderId || null,
    parentId: department.parentId || null,
    memberCount: members.total
  })
})
