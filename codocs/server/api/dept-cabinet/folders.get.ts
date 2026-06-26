/**
 * 获取部门文件柜文件夹列表
 * GET /api/dept-cabinet/folders?dept_code=xxx&parent_id=null
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface RuntimePage {
  items?: unknown[]
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const deptCode = query.dept_code as string

  if (!deptCode) {
    throw createError({ statusCode: 400, message: 'dept_code 不能为空' })
  }

  const data = await callCodocsTenantRuntime<RuntimePage>(event, '/v1/codocs/dept-cabinet/folders', {
    query,
    scope: 'codocs.read'
  })

  return { success: true, data: { items: data.items || [] } }
})
