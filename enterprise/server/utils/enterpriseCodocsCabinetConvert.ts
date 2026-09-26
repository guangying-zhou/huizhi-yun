import { createHash } from 'node:crypto'
import { createError, getHeader, getRequestURL, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createRuntimeOSSClient } from '../../../codocs/server/utils/oss'
import { docxToMarkdown } from '../../../codocs/server/utils/officeConverter'

type User = Awaited<ReturnType<typeof requireEnterpriseUser>>
type Intent = { title: string, folder_id: number | null }
type Plan = Intent & { uuid: string, owner_uid: string, source_uuid: string, source_path: string, source_ext: string, source_size: number, source_state: string, target_prefix: string, replayed: boolean, oss_path?: string }
const hashPattern = /^[0-9a-f]{64}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const statusOf = (error: unknown) => {
  const e = error as { statusCode?: number, status?: number, code?: string }
  return e?.statusCode || e?.status || (e?.code === 'NoSuchKey' ? 404 : e?.code === 'FileAlreadyExists' ? 409 : 0)
}

async function authorize(event: H3Event, user: User, operation: 'codocs.personal-cabinet-conversion-plan' | 'codocs.personal-cabinet-convert') {
  await prepareEnterpriseRuntime(event, operation)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!['view', 'create'].every(action => authorizationResourcesAllow(snapshot.resources, 'documents', action, snapshot.actionPolicies?.documents))) throw createError({ statusCode: 403, message: '缺少文件读取或文档创建权限' })
}

function validatePlan(result: unknown, user: User, source: string, intent: Intent): Plan {
  const response = result as { success?: boolean, data?: Plan }
  const plan = response?.data
  const invalid = () => createError({ statusCode: 503, message: '文件转换计划不可用' })
  if (response?.success !== true || !plan || !uuidPattern.test(plan.uuid) || plan.owner_uid !== user.uid || plan.source_uuid !== source
    || typeof plan.replayed !== 'boolean' || typeof plan.title !== 'string' || !plan.title.trim()
    || plan.folder_id !== intent.folder_id || (!plan.replayed && plan.title !== intent.title)
    || !['doc', 'docx'].includes(plan.source_ext) || !Number.isSafeInteger(plan.source_size) || plan.source_size < 0 || plan.source_size > 100 * 1024 * 1024
    || !hashPattern.test(plan.source_state) || typeof plan.source_path !== 'string'
    || !plan.source_path.startsWith(`codocs/users/${user.uid}/cabinet/`) || /[\\\x00-\x1f\x7f]/.test(plan.source_path)
    || plan.source_path.split('/').some(segment => !segment || segment === '.' || segment === '..')) throw invalid()
  const prefix = `codocs/cabinet-conversions/${plan.uuid}/`
  if (typeof plan.target_prefix !== 'string' || !plan.target_prefix.startsWith(prefix) || !/^[0-9a-f]{64}\/$/.test(plan.target_prefix.slice(prefix.length))) throw invalid()
  if (plan.replayed && (typeof plan.oss_path !== 'string' || !plan.oss_path.startsWith(plan.target_prefix) || !/^[0-9a-f]{64}\/[0-9a-f]{64}\.md$/.test(plan.oss_path.slice(plan.target_prefix.length)))) throw invalid()
  return plan
}

export async function enterpriseCodocsCabinetConvert(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const source = getRouterParam(event, 'uuid') || ''
  const key = getHeader(event, 'idempotency-key') || ''
  if (getRequestURL(event).search || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(source) || !/^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/.test(key)) throw createError({ statusCode: 400, message: '文件标识或 Idempotency-Key 无效' })
  await authorize(event, user, 'codocs.personal-cabinet-conversion-plan')
  const body = await readBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(field => !['title', 'folder_id'].includes(field))
    || typeof body.title !== 'string' || !body.title.trim() || [...body.title].length > 255
    || (body.folder_id != null && (!Number.isSafeInteger(body.folder_id) || body.folder_id < 1))) throw createError({ statusCode: 400, message: '转换标题或目录无效' })
  const intent: Intent = { title: body.title.trim(), folder_id: body.folder_id ?? null }
  const request = (payload: object) => ({
    tenant: user.tenant, deployment: user.deployment, code: source, payload,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'personal-cabinet', action: 'create', expiresAt: enterpriseRuntimePermitExpiresAt() }
  })
  const plan = validatePlan(await callEnterpriseRuntime(event, 'codocs.personal-cabinet-conversion-plan', request(intent), { idempotencyKey: key }), user, source, intent)
  if (plan.replayed) return { success: true, data: { uuid: plan.uuid, title: plan.title } }
  let client: Awaited<ReturnType<typeof createRuntimeOSSClient>>
  let bytes: Buffer
  try {
    client = await createRuntimeOSSClient({ event, timeout: 300000 })
    const object = await client.get(plan.source_path)
    bytes = Buffer.from(object.content)
    if (bytes.length !== plan.source_size) throw createError({ statusCode: 409, message: '源文件内容已变更' })
  } catch (error) {
    const status = statusOf(error)
    throw createError({ statusCode: status === 404 || status === 409 ? status : 503, message: status === 404 ? '源文件正文不存在' : status === 409 ? '源文件内容已变更' : '源文件存储暂不可用' })
  }
  let markdown: string
  try { markdown = await docxToMarkdown(bytes) } catch { throw createError({ statusCode: 422, message: '文件无法转换，请使用有效的 DOCX 文件' }) }
  const content = Buffer.from(markdown, 'utf8')
  if (content.length > 10 * 1024 * 1024) throw createError({ statusCode: 413, message: '转换后的文档正文超过 10 MiB' })
  const digest = createHash('sha256').update(content).digest('hex')
  const path = `${plan.target_prefix}${plan.source_state}/${digest}.md`
  try {
    const verify = (head: Awaited<ReturnType<typeof client.head>>) => {
      if (head.meta?.['hzy-content-sha256'] !== digest || Number(head.res?.headers?.['content-length']) !== content.length) throw createError({ statusCode: 409, message: '转换对象内容不一致' })
    }
    let missing = false
    try { verify(await client.head(path)) } catch (error) { if (statusOf(error) !== 404) throw error; missing = true }
    if (missing) {
      try { await client.put(path, content, { forbidOverwrite: true, headers: { 'Content-Type': 'text/markdown; charset=utf-8' }, meta: { 'hzy-content-sha256': digest } }) }
      catch (error) { if (![409, 412].includes(statusOf(error))) throw error; verify(await client.head(path)) }
    }
  } catch (error) { throw createError({ statusCode: statusOf(error) === 409 ? 409 : 503, message: '转换正文尚未保存，请使用相同请求重试' }) }
  await authorize(event, user, 'codocs.personal-cabinet-convert')
  const committed = validatePlan(await callEnterpriseRuntime(event, 'codocs.personal-cabinet-convert', request({ ...intent, source_state: plan.source_state, content_sha256: digest, content_size: content.length }), { idempotencyKey: key }), user, source, intent)
  if (committed.uuid !== plan.uuid || committed.target_prefix !== plan.target_prefix || (!committed.replayed && committed.oss_path !== path)) throw createError({ statusCode: 503, message: '转换提交响应无效，请重试' })
  return { success: true, data: { uuid: committed.uuid, title: committed.title } }
}
