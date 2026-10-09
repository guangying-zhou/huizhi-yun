import { createError, getQuery, getRequestURL, getRouterParam, sendRedirect, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createRuntimeOSSClient } from '../../../codocs/server/utils/oss'
import { CABINET_TEXT_PREVIEW_EXTENSIONS, readCabinetTextPreview } from '../../../codocs/server/utils/cabinetTextPreview'

export type DepartmentCabinetAction = 'folders' | 'list' | 'view' | 'converted-info' | 'download' | 'preview' | 'preview-html' | 'preview-pptx'
const code = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const ops = {
  'folders': 'codocs.department-cabinet-folders', 'list': 'codocs.department-cabinet-list', 'view': 'codocs.department-cabinet-view',
  'converted-info': 'codocs.department-cabinet-converted-info', 'download': 'codocs.department-cabinet-download'
} as const
type File = { uuid: string, owner_uid: string, dept_code: string, project_code?: string | null, oss_path: string, original_name: string, file_ext: string, file_size: number }

export function departmentCabinetQuery(event: H3Event, allowed: readonly string[]) {
  const result: Record<string, string> = {}
  const url = getRequestURL(event)
  for (const [key, value] of Object.entries(getQuery(event))) {
    if (!allowed.includes(key) || typeof value !== 'string' || url.searchParams.getAll(key).length !== 1)
      throw createError({ statusCode: 400, message: '部门柜查询参数无效' })
    result[key] = value
  }
  return result
}
export async function departmentCabinetAuthorize(event: H3Event, deptCode: string, action: 'view' | 'edit' | 'create' | 'export' | 'publish', manager = false) {
  if (!code.test(deptCode))
    throw createError({ statusCode: 400, message: '部门编码无效' })
  const user = await requireEnterpriseUser(event)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (action === 'publish') {
    if (!authorizationResourcesAllow(snapshot.resources, 'admin', 'admin', snapshot.actionPolicies?.admin)
      || !authorizationResourcesAllow(snapshot.resources, 'company', 'publish', snapshot.actionPolicies?.company))
      throw createError({ statusCode: 403, message: '缺少组织资产发布权限' })
  } else
    if (!authorizationResourcesAllow(snapshot.resources, 'departments', action, snapshot.actionPolicies?.departments))
      throw createError({ statusCode: 403, message: '缺少部门柜操作权限' })
  await prepareEnterpriseRuntime(event, 'codocs.department-access-resolve')
  let role: { success?: boolean, data?: { canRead?: boolean, canManage?: boolean } }
  try {
    role = await callEnterpriseRuntime(event, 'codocs.department-access-resolve', {
      tenant: user.tenant, deployment: user.deployment, code: deptCode,
      authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'department-access', action: 'read', expiresAt: enterpriseRuntimePermitExpiresAt() }
    }) as typeof role
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    if (status === 403 || status === 404)
      throw createError({ statusCode: 403, message: '无权访问此部门文件柜' })
    throw createError({ statusCode: 503, message: '部门目录暂不可用' })
  }
  if (role?.success !== true || typeof role.data?.canRead !== 'boolean' || typeof role.data?.canManage !== 'boolean')
    throw createError({ statusCode: 503, message: '部门目录响应无效' })
  if (!role.data.canRead || (manager && !role.data.canManage))
    throw createError({ statusCode: 403, message: '无权访问此部门文件柜' })
  return user
}
export function departmentCabinetPermit(user: Awaited<ReturnType<typeof requireEnterpriseUser>>, action: 'read' | 'edit' | 'export' | 'publish') {
  return { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'department-cabinet', action, expiresAt: enterpriseRuntimePermitExpiresAt() }
}
export async function departmentCabinetRuntime(event: H3Event, operation: typeof ops[keyof typeof ops], deptCode: string, query: Record<string, string>, action: 'read' | 'export') {
  const user = await departmentCabinetAuthorize(event, deptCode, action === 'export' ? 'export' : 'view')
  await prepareEnterpriseRuntime(event, operation)
  const response = await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant, deployment: user.deployment, code: deptCode, query,
    authorization: departmentCabinetPermit(user, action)
  }) as { success?: boolean, data?: unknown }
  if (response?.success !== true)
    throw createError({ statusCode: 503, message: '部门柜响应无效' })
  return response
}
function validateFile(value: unknown, deptCode: string, uuid?: string): asserts value is File {
  const file = value as File
  if (!file || !code.test(file.uuid) || (uuid && file.uuid !== uuid) || file.dept_code !== deptCode || file.project_code
    || !Number.isSafeInteger(file.file_size) || file.file_size < 0 || typeof file.original_name !== 'string' || !file.original_name
    || typeof file.file_ext !== 'string' || typeof file.oss_path !== 'string'
    || !file.oss_path.startsWith(`codocs/departments/${deptCode}/cabinet/`)
    || Array.from(file.oss_path).some(char => char.charCodeAt(0) <= 0x1f || char === '\\' || char.charCodeAt(0) === 0x7f) || file.oss_path.split('/').some(part => !part || part === '.' || part === '..'))
    throw createError({ statusCode: 503, message: '部门柜元数据无效' })
}
export async function readEnterpriseDepartmentCabinet(event: H3Event, action: DepartmentCabinetAction) {
  setHeader(event, 'Cache-Control', 'no-store')
  const q = departmentCabinetQuery(event, action === 'folders' ? ['dept_code', 'parent_id', 'page', 'pageSize'] : action === 'list' ? ['dept_code', 'folder_id', 'page', 'pageSize'] : ['dept_code'])
  const deptCode = q.dept_code || ''
  delete q.dept_code
  const uuid = getRouterParam(event, 'uuid') || ''
  if (!code.test(deptCode) || (!['list', 'folders'].includes(action) && !code.test(uuid)))
    throw createError({ statusCode: 400, message: '部门或文件标识无效' })
  const operation = ops[action.startsWith('preview') ? 'view' : action as keyof typeof ops]
  const requestQuery = action === 'folders' || action === 'list' ? q : { uuid }
  const response = await departmentCabinetRuntime(event, operation, deptCode, requestQuery, action === 'download' ? 'export' : 'read')
  if (action === 'folders' || action === 'list') {
    const data = response.data as { items?: unknown[], total?: number, page?: number, pageSize?: number }
    if (!data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total) || !Number.isSafeInteger(data.page) || !Number.isSafeInteger(data.pageSize))
      throw createError({ statusCode: 503, message: '部门柜列表无效' })
    if (action === 'list')
      for (const item of data.items)
        validateFile(item, deptCode)
    return response
  }
  if (action === 'converted-info')
    return response
  validateFile(response.data, deptCode, uuid)
  const file = response.data
  if (action === 'view')
    return response
  const ext = file.file_ext.toLowerCase()
  const info = { original_name: file.original_name, file_ext: ext, file_size: file.file_size, convertible: ['doc', 'docx'].includes(ext) }
  if (action === 'preview') {
    if (ext === 'pptx' || info.convertible) {
      const suffix = ext === 'pptx' ? 'preview-pptx' : 'preview-html'
      return { success: true, data: { ...info, previewable: true, preview_type: ext === 'pptx' ? 'pptx' : 'office', preview_url: `/codocs/api/dept-cabinet/${uuid}/${suffix}?dept_code=${encodeURIComponent(deptCode)}` } }
    }
    if (!CABINET_TEXT_PREVIEW_EXTENSIONS.has(ext) && !['pdf', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'mp4', 'mp3', 'wav'].includes(ext))
      return { success: true, data: { ...info, previewable: false } }
  }
  if ((action === 'preview-html' && !info.convertible) || (action === 'preview-pptx' && ext !== 'pptx'))
    throw createError({ statusCode: 400, message: '不支持此预览格式' })
  try {
    if (action === 'preview' && CABINET_TEXT_PREVIEW_EXTENSIONS.has(ext))
      return { success: true, data: { ...info, previewable: true, preview_type: 'text', ...await readCabinetTextPreview(event, file.oss_path) } }
    const client = await createRuntimeOSSClient({ event })
    if (action === 'download')
      return sendRedirect(event, await client.createSignedGetUrl(file.oss_path, { expires: 300, response: { 'content-disposition': `attachment; filename="${encodeURIComponent(file.original_name)}"` } }))
    if (action === 'preview')
      return { success: true, data: { ...info, previewable: true, preview_type: 'direct', preview_url: await client.createSignedGetUrl(file.oss_path, { expires: 300 }) } }
    const object = await client.get(file.oss_path)
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    if (action === 'preview-pptx') {
      setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
      return object.content
    }
    const { docxToHtml } = await import('../../../codocs/server/utils/officeConverter')
    const html = await docxToHtml(object.content)
    setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    setHeader(event, 'Content-Security-Policy', 'sandbox; default-src \'none\'; style-src \'unsafe-inline\'; img-src data:')
    return html
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404)
      throw error
    throw createError({ statusCode: 503, message: '部门柜存储暂不可用' })
  }
}
