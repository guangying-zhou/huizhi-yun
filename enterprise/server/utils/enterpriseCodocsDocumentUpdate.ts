import { createHash } from 'node:crypto'
import { createError, getHeader, getRequestURL, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { objectStorageVersionId } from '@hzy/foundation/server/utils/objectStorageVersion'
import { createRuntimeOSSClient } from '../../../codocs/server/utils/oss'
import { codocsSnapshotV2Enabled, mirrorSnapshotToLegacyPath, saveSnapshotV2, type SnapshotSaveBase } from './enterpriseCodocsSnapshot'

const keyPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/
const modes = new Set(['overwrite', 'recovery', 'import'])

export async function enterpriseCodocsDocumentUpdate(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const uuid = String(getRouterParam(event, 'uuid') || '')
  const key = String(getHeader(event, 'idempotency-key') || '')
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(uuid) || getRequestURL(event).search || !keyPattern.test(key)) throw createError({ statusCode: 400, message: '文档保存请求无效' })
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(field => !['title', 'content', 'saveMode', 'expectedGeneration', 'expectedEpoch', 'titleChanged'].includes(field))
    || typeof body.title !== 'string' || !body.title.trim() || [...body.title].length > 255 || (body.content !== undefined && typeof body.content !== 'string')) throw createError({ statusCode: 400, message: '文档保存字段无效' })
  const badGeneration = body.expectedGeneration !== undefined && (!Number.isSafeInteger(body.expectedGeneration) || (body.expectedGeneration as number) < 0)
  const badEpoch = body.expectedEpoch !== undefined && (!Number.isSafeInteger(body.expectedEpoch) || (body.expectedEpoch as number) < 0)
  const badTitleChange = body.titleChanged !== undefined && typeof body.titleChanged !== 'boolean'
  if (badGeneration || badEpoch || badTitleChange) throw createError({ statusCode: 400, message: '文档保存前置条件无效' })
  const content = body.content as string | undefined
  const mode = String(body.saveMode || (content === undefined ? 'metadata' : 'overwrite'))
  if (content === undefined ? mode !== 'metadata' : !modes.has(mode)) throw createError({ statusCode: 400, message: '文档保存模式无效' })
  const bytes = content === undefined ? undefined : Buffer.from(content, 'utf8')
  if (bytes && bytes.length > 10 * 1024 * 1024) throw createError({ statusCode: 413, message: '文档正文超过 10 MiB' })
  const user = await requireEnterpriseUser(event)
  const updateOperation = 'codocs.personal-document-update' as const
  const planOperation = 'codocs.personal-document-update-plan' as const
  async function authorize(operation: typeof planOperation | typeof updateOperation) {
    await prepareEnterpriseRuntime(event, operation)
    const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
    if (!authorizationResourcesAllow(snapshot.resources, 'documents', 'edit', snapshot.actionPolicies?.documents)) throw createError({ statusCode: 403, message: '缺少文档编辑权限' })
    return { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'personal-documents', action: 'edit', expiresAt: enterpriseRuntimePermitExpiresAt() }
  }
  if (bytes && codocsSnapshotV2Enabled(event)) {
    const base = Number.isSafeInteger(body.expectedGeneration) && Number.isSafeInteger(body.expectedEpoch) && typeof body.titleChanged === 'boolean'
      ? { expectedGeneration: body.expectedGeneration as number, expectedEpoch: body.expectedEpoch as number, titleChanged: body.titleChanged }
      : null
    const v2 = await enterpriseCodocsDocumentUpdateV2(event, user, uuid, key, body.title.trim(), bytes, mode, authorize, base)
    if (v2) return v2
  }
  const payload: Record<string, unknown> = { title: body.title.trim() }
  if (bytes) Object.assign(payload, { content_size: bytes.length, content_sha256: createHash('sha256').update(bytes).digest('hex'), save_mode: mode })
  // The owning Runtime checks the actual write ACL and durable command receipt
  // before any storage access. Replaying a completed save must not overwrite
  // bytes produced by a later save, even if the first response was lost.
  const metadata = await callEnterpriseRuntime<{ success?: boolean, data?: { uuid?: string, oss_path?: string, doc_type?: string, replayed?: boolean } }>(event, planOperation, {
    tenant: user.tenant, deployment: user.deployment, code: uuid, payload, authorization: await authorize(planOperation)
  }, { idempotencyKey: key })
  const doc = metadata?.data
  if (metadata?.success !== true || doc?.uuid !== uuid || typeof doc.replayed !== 'boolean') throw createError({ statusCode: 503, message: '文档保存计划无效' })
  if (doc.replayed) return { success: true, data: { uuid, updated: true, contentUpdated: content !== undefined, replayed: true } }
  if (typeof doc.oss_path !== 'string' || typeof doc.doc_type !== 'string') throw createError({ statusCode: 503, message: '文档保存元数据无效' })
  if (bytes) {
    if (!doc.oss_path) throw createError({ statusCode: 409, message: '文档存储路径缺失' })
    try {
      const client = await createRuntimeOSSClient({ event })
      let meta: Record<string, string> = {}
      try {
        const head = await client.head(doc.oss_path)
        meta = Object.fromEntries(Object.entries(head.meta || {}).map(([name, value]) => [name, String(value)]))
      } catch (error) {
        const missing = error as { code?: string, status?: number, statusCode?: number }
        if (missing.code !== 'NoSuchKey' && missing.status !== 404 && missing.statusCode !== 404) throw error
      }
      const stored = await client.put(doc.oss_path, bytes, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' }, meta })
      const versionId = objectStorageVersionId(stored.res.headers as Record<string, string>)
      if (!versionId) throw new Error('object storage version id missing')
      payload.oss_version_id = versionId
    } catch { throw createError({ statusCode: 503, message: '文档正文尚未保存，请使用相同请求重试' }) }
  }
  return callEnterpriseRuntime(event, updateOperation, {
    tenant: user.tenant, deployment: user.deployment, code: uuid, payload, authorization: await authorize(updateOperation)
  }, { idempotencyKey: key })
}

type Permit = { actorUid: string, tenant: string, deployment: string, resource: string, action: string, expiresAt: number }

// v2 applies to private documents only (the Runtime snapshot reader serves
// private documents); other types keep the v1 path. Returns null for those.
async function enterpriseCodocsDocumentUpdateV2(
  event: H3Event, user: Awaited<ReturnType<typeof requireEnterpriseUser>>, uuid: string, key: string, title: string, bytes: Buffer, mode: string,
  authorize: (operation: 'codocs.personal-document-update-plan' | 'codocs.personal-document-update') => Promise<Permit>,
  base: (SnapshotSaveBase & { titleChanged: boolean }) | null
) {
  const viewOperation = 'codocs.personal-document-view' as const
  await prepareEnterpriseRuntime(event, viewOperation)
  const metadata = await callEnterpriseRuntime<{ success?: boolean, data?: { uuid?: string, oss_path?: string | null, doc_type?: string, title?: string } }>(event, viewOperation, {
    tenant: user.tenant, deployment: user.deployment, code: uuid, query: {},
    authorization: { ...(await authorize('codocs.personal-document-update-plan')), action: 'read' }
  })
  const doc = metadata?.data
  if (metadata?.success !== true || doc?.uuid !== uuid || typeof doc.doc_type !== 'string') throw createError({ statusCode: 503, message: '文档元数据响应无效' })
  if (doc.doc_type !== 'private') return null
  if (!base) throw createError({ statusCode: 428, message: '请先读取文档当前版本再保存', data: { code: 'snapshot_precondition_required' } })
  const saved = await saveSnapshotV2(event, user, uuid, key, bytes, base)
  // Title changes stay on the v1 metadata command, which carries no content.
  let titleResult: 'unchanged' | 'updated' | 'replayed' = 'unchanged'
  if (base.titleChanged) {
    const titleKey = `${key}:title`.slice(0, 200)
    const titlePayload = { title }
    const plan = await callEnterpriseRuntime<{ success?: boolean, data?: { replayed?: boolean } }>(event, 'codocs.personal-document-update-plan', {
      tenant: user.tenant, deployment: user.deployment, code: uuid, payload: titlePayload, authorization: await authorize('codocs.personal-document-update-plan')
    }, { idempotencyKey: titleKey })
    if (plan?.success !== true || typeof plan.data?.replayed !== 'boolean') throw createError({ statusCode: 503, message: '文档标题保存计划无效' })
    if (plan.data.replayed) titleResult = 'replayed'
    else {
      const titleSave = await callEnterpriseRuntime<{ success?: boolean, data?: { updated?: boolean } }>(event, 'codocs.personal-document-update', {
        tenant: user.tenant, deployment: user.deployment, code: uuid, payload: titlePayload, authorization: await authorize('codocs.personal-document-update')
      }, { idempotencyKey: titleKey })
      if (titleSave?.success !== true || titleSave.data?.updated !== true) throw createError({ statusCode: 503, message: '文档标题保存结果无效' })
      titleResult = 'updated'
    }
  }
  const mirrored = await mirrorSnapshotToLegacyPath(event, user, uuid, typeof doc.oss_path === 'string' ? doc.oss_path : '', saved.generation, bytes)
  return { success: true, data: { uuid, updated: true, contentUpdated: true, replayed: saved.replayed, generation: saved.generation,
    epoch: base.expectedEpoch, titleResult, saveMode: mode, mirrorPending: !mirrored } }
}
