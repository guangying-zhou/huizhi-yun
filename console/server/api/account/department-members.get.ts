import {
  getDirectoryDepartment,
  listDirectoryDepartmentMembers,
  ok
} from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const deptCode = String(query.deptCode || query.dept_code || '').trim()
  if (!deptCode) throw createError({ statusCode: 400, message: '缺少 deptCode' })

  const [department, members] = await Promise.all([
    getDirectoryDepartment(deptCode),
    listDirectoryDepartmentMembers(deptCode, query)
  ])
  const parentDepartment = department?.parentId ? await getDirectoryDepartment(department.parentId) : null
  const manager = department?.managerId
    ? members.items.find(member => member.uid === department.managerId)
    : null

  return ok({
    managerId: department?.managerId || null,
    managerName: manager?.realName || department?.manager || department?.managerId || null,
    leaderId: department?.leaderId || null,
    parentManagerId: parentDepartment?.managerId || null,
    parentLeaderId: parentDepartment?.leaderId || null,
    members: members.items.map(member => ({
      uid: member.uid,
      realName: member.realName || member.uid
    }))
  })
})
