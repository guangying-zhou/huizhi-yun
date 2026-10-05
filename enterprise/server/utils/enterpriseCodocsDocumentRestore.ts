import { createError, getHeader, getRequestURL, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createRuntimeOSSClient, resolveDocumentOssTimeoutMs } from '../../../codocs/server/utils/oss'
import { copyRestoreObjects } from './codocsRestoreObjects'

type RestorePlan = { uuid: string, title: string, doc_type: string, source_path: string, target_path: string, state_sha256: string, deleted: boolean, snapshot_backed?: boolean }
const safePath = (value: unknown): value is string => typeof value === 'string' && /^(codocs|recycle\.bin)\//.test(value)
  // eslint-disable-next-line no-control-regex -- reject NUL and line breaks in object keys
  && !/[\\\x00\r\n]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..')

export async function enterpriseCodocsDocumentRestore(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const uuid = getRouterParam(event, 'uuid') || ''
  const key = getHeader(event, 'idempotency-key') || ''
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(uuid) || getRequestURL(event).search || !/^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/.test(key)) throw createError({ statusCode: 400, message: '恢复请求需要文档标识和有效的 Idempotency-Key' })
  const authorize = async (operation: 'codocs.personal-document-restore-plan' | 'codocs.personal-document-restore') => {
    await prepareEnterpriseRuntime(event, operation)
    const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
    if (!authorizationResourcesAllow(snapshot.resources, 'documents', 'edit', snapshot.actionPolicies?.documents)) throw createError({ statusCode: 403, message: '缺少文档恢复权限' })
    return { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'personal-documents', action: 'edit', expiresAt: enterpriseRuntimePermitExpiresAt() }
  }
  const authorization = await authorize('codocs.personal-document-restore-plan')
  const body = await readBody<Record<string, unknown>>(event) ?? {}
  if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(field => field !== 'new_title')
    || ('new_title' in body && (typeof body.new_title !== 'string' || !body.new_title.trim() || [...body.new_title].length > 255))) throw createError({ statusCode: 400, message: '恢复请求只接受可选的新标题' })
  const payload = typeof body.new_title === 'string' ? { new_title: body.new_title.trim() } : {}
  const response = await callEnterpriseRuntime(event, 'codocs.personal-document-restore-plan', {
    tenant: user.tenant, deployment: user.deployment, code: uuid, payload, authorization
  }, { idempotencyKey: key }) as { success?: boolean, data?: RestorePlan }
  const plan = response?.data
  if (response?.success !== true || !plan || plan.uuid !== uuid || !['private', 'slide', 'worklog', 'weekly-report'].includes(plan.doc_type)
    || typeof plan.title !== 'string' || !plan.title || typeof plan.deleted !== 'boolean' || !/^[0-9a-f]{64}$/.test(plan.state_sha256)
    || !safePath(plan.source_path) || !safePath(plan.target_path)
    || (plan.snapshot_backed !== undefined && typeof plan.snapshot_backed !== 'boolean')
    || (plan.source_path.startsWith('codocs/') ? plan.target_path !== plan.source_path : plan.target_path !== `codocs/document-restores/${uuid}/${plan.state_sha256}.md`)) {
    throw createError({ statusCode: 503, message: '文档恢复计划无效' })
  }
  // Snapshot-backed (v2) documents restore by status only; nothing is copied.
  if (plan.deleted && plan.snapshot_backed !== true) {
    // Copy only; never delete source objects before or after a database commit here.
    await copyRestoreObjects(
      () => createRuntimeOSSClient({ event, timeout: resolveDocumentOssTimeoutMs() }),
      plan,
      { unavailable: '文档存储暂不可用，请使用相同请求重试', notFound: '可恢复的正文和协作快照均不存在' }
    )
  }
  // Permissions may change during storage work; do not reuse the old permit.
  const commitAuthorization = await authorize('codocs.personal-document-restore')
  return callEnterpriseRuntime(event, 'codocs.personal-document-restore', {
    tenant: user.tenant, deployment: user.deployment, code: uuid,
    payload: { ...payload, state_sha256: plan.state_sha256 }, authorization: commitAuthorization
  }, { idempotencyKey: key })
}
