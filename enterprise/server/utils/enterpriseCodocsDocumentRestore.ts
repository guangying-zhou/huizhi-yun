import { createError, getHeader, getRequestURL, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createRuntimeOSSClient } from '../../../codocs/server/utils/oss'

type RestorePlan = { uuid: string, title: string, doc_type: string, source_path: string, target_path: string, state_sha256: string, deleted: boolean }
const missing = (error: unknown) => {
  const e = error as { status?: number, statusCode?: number, code?: string }
  return e?.status === 404 || e?.statusCode === 404 || e?.code === 'NoSuchKey'
}
const safePath = (value: unknown): value is string => typeof value === 'string' && /^(codocs|recycle\.bin)\//.test(value)
  && !/[\\\x00\r\n]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..')
const yjsPath = (path: string) => path.endsWith('.md') ? path.replace(/\.md$/, '.yjs') : `${path}.yjs`

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
    || (plan.source_path.startsWith('codocs/') ? plan.target_path !== plan.source_path : plan.target_path !== `codocs/document-restores/${uuid}/${plan.state_sha256}.md`)) {
    throw createError({ statusCode: 503, message: '文档恢复计划无效' })
  }
  if (plan.deleted) {
    try {
      const client = await createRuntimeOSSClient({ event })
      let found = false
      // Preserve both Markdown and any surviving CRDT snapshot. Copy only;
      // never delete source objects before or after a database commit here.
      for (const [source, target] of [[plan.source_path, plan.target_path], [yjsPath(plan.source_path), yjsPath(plan.target_path)]] as [string, string][]) {
        if (source === target) {
          try {
            await client.head(source)
          } catch (error) {
            if (missing(error)) continue
            throw error
          }
          found = true
          continue
        }
        try {
          await client.head(target)
          found = true
          continue
        } catch (error) {
          if (!missing(error)) throw error
        }
        let object
        try {
          object = await client.get(source)
        } catch (error) {
          if (missing(error)) continue
          throw error
        }
        try {
          await client.put(target, object.content, { forbidOverwrite: true })
        } catch (error) {
          const e = error as { status?: number, statusCode?: number, code?: string }
          if (![409, 412].includes(e.status || e.statusCode || 0) && e.code !== 'FileAlreadyExists') {
            throw createError({ statusCode: 503, message: '恢复目标尚未写入' })
          }
          try {
            await client.head(target)
          } catch {
            // A missing winner is not an optional missing source. In
            // particular, do not drop a CRDT snapshot after copying Markdown.
            throw createError({ statusCode: 503, message: '恢复目标尚未确认' })
          }
        }
        found = true
      }
      if (!found) throw createError({ statusCode: 404, message: '可恢复的正文和协作快照均不存在' })
    } catch (error) {
      if ((error as { statusCode?: number })?.statusCode === 404) throw error
      throw createError({ statusCode: 503, message: '文档存储暂不可用，请使用相同请求重试' })
    }
  }
  // Permissions may change during storage work; do not reuse the old permit.
  const commitAuthorization = await authorize('codocs.personal-document-restore')
  return callEnterpriseRuntime(event, 'codocs.personal-document-restore', {
    tenant: user.tenant, deployment: user.deployment, code: uuid,
    payload: { ...payload, state_sha256: plan.state_sha256 }, authorization: commitAuthorization
  }, { idempotencyKey: key })
}
