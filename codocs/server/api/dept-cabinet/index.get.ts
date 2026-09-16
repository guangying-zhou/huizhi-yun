import { listCabinetFileMetadata } from '~~/server/utils/cabinetRuntime'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const deptCode = query.dept_code as string

  if (!deptCode) {
    throw createError({ statusCode: 400, message: 'dept_code 不能为空' })
  }

  const data = await listCabinetFileMetadata(event, 'department', query, { departmentCode: deptCode })

  return { success: true, data: { items: data.items || [] } }
})
