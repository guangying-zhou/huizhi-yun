import { createError, setHeader } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { departmentCabinetAuthorize, departmentCabinetQuery } from '~~/server/utils/enterpriseCodocsDepartmentCabinet'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'no-store')
  const query = departmentCabinetQuery(event, ['dept_code', 'page', 'pageSize'])
  const department = query.dept_code || ''
  const page = query.page || '1', pageSize = query.pageSize || '100'
  if (!/^[1-9]\d*$/.test(page) || Number(page) > 1_000_000 || !/^[1-9]\d*$/.test(pageSize) || Number(pageSize) > 100) throw createError({ statusCode: 400, message: '目录分页参数无效' })
  const user = await departmentCabinetAuthorize(event, department, 'view')
  await prepareEnterpriseRuntime(event, 'codocs.department-folders-list')
  const result = await callEnterpriseRuntime(event, 'codocs.department-folders-list', {
    tenant: user.tenant, deployment: user.deployment, code: department, query: { page, pageSize },
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'department-folders', action: 'read', expiresAt: enterpriseRuntimePermitExpiresAt() }
  }) as { success?: boolean, data?: { items?: unknown[], total?: number } }
  if (result?.success !== true || !Array.isArray(result.data?.items) || !Number.isSafeInteger(result.data.total)) throw createError({ statusCode: 503, message: '部门文档目录不可用' })
  return result
})
