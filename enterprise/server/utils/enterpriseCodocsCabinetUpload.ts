import { createHash } from 'node:crypto'
import { createError, getHeader, getRequestURL, readMultipartFormData, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createRuntimeOSSClient } from '../../../codocs/server/utils/oss'

const maxSize = 100 * 1024 * 1024
const extensions = new Set('doc docx ppt pptx pdf txt csv rtf zip rar 7z tar gz png jpg jpeg gif bmp webp svg mp4 mp3 wav avi mov json xml yaml yml html css js ts java py go rs c cpp h sql sh bat'.split(' '))
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
type UploadFacts = { original_name: string, file_ext: string, file_size: number, content_sha256: string, folder_id: number | null }
type UploadPlan = UploadFacts & { uuid: string, owner_uid: string, oss_path: string, filename: string, id?: number }
type User = Awaited<ReturnType<typeof requireEnterpriseUser>>
const statusOf = (error: unknown) => {
  const value = error as { statusCode?: number, status?: number, code?: string }
  return value?.statusCode || value?.status || (value?.code === 'NoSuchKey' ? 404 : value?.code === 'FileAlreadyExists' ? 409 : 0)
}

function contentType(ext: string) {
  const types: Record<string, string> = {
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', rtf: 'text/rtf', zip: 'application/zip',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml',
    mp4: 'video/mp4', avi: 'video/x-msvideo', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav',
    json: 'application/json', xml: 'application/xml', html: 'text/html', css: 'text/css', js: 'application/javascript'
  }
  return types[ext] || 'application/octet-stream'
}

async function authorize(event: H3Event, user: User, operation: 'codocs.personal-cabinet-upload-plan' | 'codocs.personal-cabinet-upload') {
  await prepareEnterpriseRuntime(event, operation)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'documents', 'create', snapshot.actionPolicies?.documents)) throw createError({ statusCode: 403, message: '缺少文件上传权限' })
}

function validatePlan(result: unknown, user: User, facts: UploadFacts): UploadPlan {
  const response = result as { success?: boolean, data?: UploadPlan }
  const plan = response?.data
  if (response?.success !== true || !plan || typeof plan.uuid !== 'string' || !uuidPattern.test(plan.uuid)
    || plan.owner_uid !== user.uid || Object.entries(facts).some(([key, value]) => plan[key as keyof UploadFacts] !== value)
    || plan.filename !== facts.original_name.replace(/[\\/:*?"<>|]/g, '_') || typeof plan.oss_path !== 'string') {
    throw createError({ statusCode: 503, message: '文件上传计划不可用' })
  }
  const prefix = `codocs/users/${user.uid}/cabinet/${plan.uuid}/`
  if (!plan.oss_path.startsWith(prefix) || !new RegExp(`^[0-9a-f]{64}\\.${facts.file_ext}$`).test(plan.oss_path.slice(prefix.length))) throw createError({ statusCode: 503, message: '文件存储路径无效' })
  return plan
}

async function uploadFile(event: H3Event, user: User, facts: UploadFacts, bytes: Buffer, key: string) {
  const request = () => ({
    tenant: user.tenant, deployment: user.deployment, payload: facts,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'personal-cabinet', action: 'create', expiresAt: enterpriseRuntimePermitExpiresAt() }
  })
  await authorize(event, user, 'codocs.personal-cabinet-upload-plan')
  const plan = validatePlan(await callEnterpriseRuntime(event, 'codocs.personal-cabinet-upload-plan', request(), { idempotencyKey: key }), user, facts)
  try {
    const client = await createRuntimeOSSClient({ event, timeout: 300000 })
    const verifyObject = (head: Awaited<ReturnType<typeof client.head>>) => {
      if (head.meta?.['hzy-content-sha256'] !== facts.content_sha256 || Number(head.res?.headers?.['content-length']) !== bytes.length) throw createError({ statusCode: 409, message: '上传对象与文件内容不一致' })
    }
    let missing = false
    try { verifyObject(await client.head(plan.oss_path)) }
    catch (error) { if (statusOf(error) !== 404) throw error; missing = true }
    if (missing) {
      try {
        await client.put(plan.oss_path, bytes, { forbidOverwrite: true, headers: { 'Content-Type': contentType(facts.file_ext) }, meta: { 'hzy-content-sha256': facts.content_sha256 } })
      } catch (error) {
        if (![409, 412].includes(statusOf(error))) throw error
        verifyObject(await client.head(plan.oss_path))
      }
    }
  } catch (error) {
    throw createError({ statusCode: statusOf(error) === 409 ? 409 : 503, message: '文件尚未保存，请使用相同文件重试' })
  }
  // Uploads can outlive a permit. Never reuse the pre-storage authorization.
  await authorize(event, user, 'codocs.personal-cabinet-upload')
  const committed = validatePlan(await callEnterpriseRuntime(event, 'codocs.personal-cabinet-upload', request(), { idempotencyKey: key }), user, facts)
  if (committed.uuid !== plan.uuid || committed.oss_path !== plan.oss_path || !Number.isSafeInteger(committed.id) || Number(committed.id) < 1) throw createError({ statusCode: 503, message: '上传提交结果不可用，请重试' })
  return committed
}

export async function enterpriseCodocsCabinetUpload(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const key = getHeader(event, 'idempotency-key') || ''
  if (getRequestURL(event).search || !/^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/.test(key)) throw createError({ statusCode: 400, message: '上传不接受查询参数，且需要有效的 Idempotency-Key' })
  await authorize(event, user, 'codocs.personal-cabinet-upload-plan')
  // Includes a small multipart framing allowance; bytes are checked again
  // after parsing, including requests with no Content-Length header.
  if (Number(getHeader(event, 'content-length') || 0) > maxSize + 1024 * 1024) throw createError({ statusCode: 413, message: '每次请求最多上传 100 MiB 文件内容' })
  const parts = await readMultipartFormData(event)
  if (!parts?.length) throw createError({ statusCode: 400, message: '没有上传文件' })
  if (parts.reduce((sum, part) => sum + part.data.length, 0) > maxSize + 1024 * 1024) throw createError({ statusCode: 413, message: '上传请求过大' })
  const fields: Record<string, string> = {}
  const files = []
  for (const part of parts) {
    if (part.filename !== undefined) {
      if (part.name !== 'files') throw createError({ statusCode: 400, message: '文件字段无效' })
      files.push(part)
    } else {
      if (!part.name || !['owner_uid', 'folder_id'].includes(part.name) || part.name in fields) throw createError({ statusCode: 400, message: '上传字段无效' })
      fields[part.name] = part.data.toString('utf8')
    }
  }
  if (fields.owner_uid !== undefined && fields.owner_uid !== user.uid) throw createError({ statusCode: 403, message: '不能为其他用户上传文件' })
  const rawFolder = fields.folder_id
  const folder = !rawFolder || rawFolder === 'null' ? null : Number(rawFolder)
  if (folder !== null && (!/^[1-9]\d*$/.test(rawFolder!) || !Number.isSafeInteger(folder))) throw createError({ statusCode: 400, message: '目录标识无效' })
  if (!files.length || files.length > 30) throw createError({ statusCode: 400, message: '每次请求需要 1–30 个文件' })
  if (files.reduce((sum, file) => sum + file.data.length, 0) > maxSize) throw createError({ statusCode: 413, message: '每次请求最多上传 100 MiB 文件内容' })
  const result = { success: 0, failed: 0, items: [] as Array<{ filename: string, status: 'success' | 'error', uuid?: string, message?: string }> }
  for (const [index, file] of files.entries()) {
    const name = file.filename || ''
    const ext = name.split('.').pop()?.toLowerCase() || ''
    try {
      if (!name.trim() || [...name].length > 255 || /[\\/\x00-\x1f\x7f]/.test(name) || !name.includes('.') || !extensions.has(ext)) throw createError({ statusCode: 400, message: '文件名称或类型无效' })
      const itemKey = `cabinet:upload:${createHash('sha256').update(JSON.stringify([user.tenant, user.deployment, user.uid, key, index])).digest('hex')}`
      const facts = { original_name: name, file_ext: ext, file_size: file.data.length, content_sha256: createHash('sha256').update(file.data).digest('hex'), folder_id: folder }
      const row = await uploadFile(event, user, facts, file.data, itemKey)
      result.success++
      result.items.push({ filename: name, status: 'success', uuid: row.uuid })
    } catch (error) {
      const status = statusOf(error)
      if (status === 401 || status === 403) throw createError({ statusCode: status, message: '文件上传授权已失效' })
      result.failed++
      result.items.push({ filename: name, status: 'error', message: status === 400 ? '文件名称或类型无效（Markdown 请使用我的文档上传）' : status === 409 ? '文件或请求内容已变更，请重新选择后上传' : '上传暂未完成，请使用相同文件重试' })
    }
  }
  return result
}
