import { createError, getHeader, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { departmentCabinetAuthorize, departmentCabinetPermit, departmentCabinetQuery } from './enterpriseCodocsDepartmentCabinet'

type Action = 'update' | 'delete' | 'folder-create' | 'folder-update' | 'folder-delete'
const code = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/
const operations = {
  'update': 'codocs.department-cabinet-update', 'delete': 'codocs.department-cabinet-delete',
  'folder-create': 'codocs.department-cabinet-folder-create', 'folder-update': 'codocs.department-cabinet-folder-update',
  'folder-delete': 'codocs.department-cabinet-folder-delete'
} as const

export async function writeEnterpriseDepartmentCabinet(event: H3Event, action: Action) {
  setHeader(event, 'Cache-Control', 'no-store')
  const q = departmentCabinetQuery(event, ['dept_code'])
  const deptCode = q.dept_code || ''
  const key = getHeader(event, 'idempotency-key') || ''
  if (!code.test(deptCode) || !keyPattern.test(key)) throw createError({ statusCode: 400, message: '部门或 Idempotency-Key 无效' })
  const user = await departmentCabinetAuthorize(event, deptCode, 'edit', true)
  const pathCode = getRouterParam(event, action.startsWith('folder-') ? 'id' : 'uuid') || ''
  if ((['update', 'delete'].includes(action) && !code.test(pathCode)) || (['folder-update', 'folder-delete'].includes(action) && !/^[1-9]\d*$/.test(pathCode))) throw createError({ statusCode: 400, message: '文件或目录标识无效' })
  const body = action === 'delete' || action === 'folder-delete' ? {} : await readBody<Record<string, unknown>>(event)
  if (!body || Array.isArray(body) || typeof body !== 'object') throw createError({ statusCode: 400, message: '部门柜请求无效' })
  const allowed = action === 'update' ? ['filename', 'folder_id'] : action === 'folder-create' || action === 'folder-update' ? ['name', 'folder_id'] : []
  if (Object.keys(body).some(field => !allowed.includes(field))) throw createError({ statusCode: 400, message: '部门柜字段无效' })
  const payload = { ...body, ...(pathCode ? { [action.startsWith('folder-') ? 'id' : 'uuid']: action.startsWith('folder-') ? Number(pathCode) : pathCode } : {}) }
  await prepareEnterpriseRuntime(event, operations[action])
  const result = await callEnterpriseRuntime(event, operations[action], {
    tenant: user.tenant, deployment: user.deployment, code: deptCode, payload,
    authorization: departmentCabinetPermit(user, 'edit')
  }, { idempotencyKey: key }) as { success?: boolean, data?: unknown }
  if (result?.success !== true) throw createError({ statusCode: 503, message: '部门柜写入结果无效' })
  return result
}
