import { listDirectoryDepartmentMembers, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const deptCode = String(query.deptCode || query.dept_code || '').trim()
  if (!deptCode) throw createError({ statusCode: 400, message: '缺少 deptCode 参数' })

  const result = await listDirectoryDepartmentMembers(deptCode, query)
  return ok(result.items.map(member => ({
    uid: member.uid,
    realName: member.realName,
    email: member.email,
    position: member.positionTitle || null,
    dingtalkId: member.dingtalkId || null,
    isPrimary: member.deptCode === deptCode
  })))
})
