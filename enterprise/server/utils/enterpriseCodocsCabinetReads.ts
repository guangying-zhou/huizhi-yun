import { createError, getQuery, getRequestURL, getRouterParam, sendRedirect, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createRuntimeOSSClient } from '../../../codocs/server/utils/oss'
import { CABINET_TEXT_PREVIEW_EXTENSIONS, readCabinetTextPreview } from '../../../codocs/server/utils/cabinetTextPreview'

const operations = {
  list: 'codocs.personal-cabinet-list', view: 'codocs.personal-cabinet-view',
  download: 'codocs.personal-cabinet-download', 'converted-info': 'codocs.personal-cabinet-converted-info'
} as const
type CabinetAction = keyof typeof operations | 'preview' | 'preview-html' | 'preview-pptx'
type CabinetFile = { uuid: string, owner_uid: string, dept_code?: string | null, project_code?: string | null, oss_path: string, original_name: string, file_ext: string, file_size: number }

function validateFile(value: unknown, actor: string, uuid?: string): asserts value is CabinetFile {
  const file = value as CabinetFile
  if (!file || typeof file.uuid !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(file.uuid) || (uuid && file.uuid !== uuid)
    || file.owner_uid !== actor || file.dept_code || file.project_code
    || typeof file.original_name !== 'string' || !file.original_name || typeof file.file_ext !== 'string'
    || !Number.isSafeInteger(file.file_size) || file.file_size < 0
    || typeof file.oss_path !== 'string' || !file.oss_path.startsWith(`codocs/users/${actor}/cabinet/`)
    || /[\\\x00\r\n]/.test(file.oss_path) || file.oss_path.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw createError({ statusCode: 503, message: '文件柜元数据响应无效' })
  }
}

export async function enterpriseCodocsCabinetRead(event: H3Event, action: CabinetAction) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const operation = operations[action.startsWith('preview') ? 'view' : action as keyof typeof operations]
  const uuid = getRouterParam(event, 'uuid') || ''
  if (action !== 'list' && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(uuid)) throw createError({ statusCode: 400, message: '文件标识无效' })
  const query: Record<string, string> = {}
  const parameters = getRequestURL(event).searchParams
  for (const [key, value] of Object.entries(getQuery(event))) {
    if (action !== 'list' || typeof value !== 'string' || parameters.getAll(key).length !== 1) throw createError({ statusCode: 400, message: '文件柜查询参数无效' })
    if (key === 'owner_uid') {
      if (value !== user.uid) throw createError({ statusCode: 403, message: '不能选择其他用户的文件柜' })
    } else if (['page', 'pageSize', 'folder_id'].includes(key)) query[key] = value
    else throw createError({ statusCode: 400, message: '文件柜查询参数无效' })
  }
  await prepareEnterpriseRuntime(event, operation)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  const permission = action === 'download' ? 'export' : 'view'
  if (!authorizationResourcesAllow(snapshot.resources, 'documents', permission, snapshot.actionPolicies?.documents)) throw createError({ statusCode: 403, message: '缺少文件柜操作权限' })
  const response = await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant, deployment: user.deployment, ...(action === 'list' ? {} : { code: uuid }), query,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'personal-cabinet', action: action === 'download' ? 'export' : 'read', expiresAt: enterpriseRuntimePermitExpiresAt() }
  }) as { success?: boolean, data?: unknown }
  if (response?.success !== true) throw createError({ statusCode: 503, message: '文件柜响应无效' })
  if (action === 'list') {
    const data = response.data as { items?: unknown[], total?: number, page?: number, pageSize?: number }
    if (!data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total) || Number(data.total) < 0 || !Number.isSafeInteger(data.page) || Number(data.page) < 1 || !Number.isSafeInteger(data.pageSize) || Number(data.pageSize) < 1 || Number(data.pageSize) > 200) throw createError({ statusCode: 503, message: '文件柜列表响应无效' })
    for (const file of data.items) validateFile(file, user.uid)
    return response
  }
  if (action === 'converted-info') {
    const doc = response.data as { doc_uuid?: string, doc_title?: string, doc_path?: string } | null
    if (doc !== null && (!doc || typeof doc.doc_uuid !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(doc.doc_uuid) || typeof doc.doc_title !== 'string' || typeof doc.doc_path !== 'string')) throw createError({ statusCode: 503, message: '转存文档响应无效' })
    return response
  }
  validateFile(response.data, user.uid, uuid)
  const file = response.data
  if (action === 'view') return response
  const ext = file.file_ext.toLowerCase()
  const info = { original_name: file.original_name, file_ext: ext, file_size: file.file_size, convertible: ['doc', 'docx'].includes(ext) }
  if (action === 'preview') {
    if (ext === 'pptx' || info.convertible) {
      const suffix = ext === 'pptx' ? 'preview-pptx' : 'preview-html'
      return { success: true, data: { ...info, previewable: true, preview_type: ext === 'pptx' ? 'pptx' : 'office', preview_url: `/codocs/api/cabinet/${uuid}/${suffix}` } }
    }
    if (!CABINET_TEXT_PREVIEW_EXTENSIONS.has(ext) && !['pdf', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'mp4', 'mp3', 'wav'].includes(ext)) return { success: true, data: { ...info, previewable: false } }
  }
  if (action === 'preview-html' && !info.convertible || action === 'preview-pptx' && ext !== 'pptx') throw createError({ statusCode: 400, message: '不支持该文件的预览格式' })
  try {
    if (action === 'preview' && CABINET_TEXT_PREVIEW_EXTENSIONS.has(ext)) {
      return { success: true, data: { ...info, previewable: true, preview_type: 'text', ...await readCabinetTextPreview(event, file.oss_path) } }
    }
    const client = await createRuntimeOSSClient({ event })
    if (action === 'download') {
      const url = await client.createSignedGetUrl(file.oss_path, { expires: 300, response: { 'content-disposition': `attachment; filename="${encodeURIComponent(file.original_name)}"; filename*=UTF-8''${encodeURIComponent(file.original_name)}` } })
      return sendRedirect(event, url)
    }
    if (action === 'preview') return { success: true, data: { ...info, previewable: true, preview_type: 'direct', preview_url: await client.createSignedGetUrl(file.oss_path, { expires: 300 }) } }
    const object = await client.get(file.oss_path)
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    if (action === 'preview-pptx') {
      setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
      return object.content
    }
    const { docxToHtml } = await import('../../../codocs/server/utils/officeConverter')
    let html: string
    try { html = await docxToHtml(object.content) } catch { throw createError({ statusCode: 422, message: '文件无法转换为 Office 预览' }) }
    // Converted Office markup is untrusted input on the Host origin.
    setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    setHeader(event, 'Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:")
    return html
  } catch (error) {
    const e = error as { status?: number, statusCode?: number, code?: string }
    if (e.statusCode === 422) throw error
    if (e.status === 404 || e.statusCode === 404 || e.code === 'NoSuchKey') throw createError({ statusCode: 404, message: '文件正文不存在' })
    throw createError({ statusCode: 503, message: '文件柜存储暂不可用' })
  }
}
