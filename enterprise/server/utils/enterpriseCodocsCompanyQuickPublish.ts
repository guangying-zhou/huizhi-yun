import { createHash } from 'node:crypto'
import { createError, getQuery, getRequestURL, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { fetchConsoleDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'
import { createRuntimeOSSClient } from '../../../codocs/server/utils/oss'
import { copyQuickPublishDocument, type QuickPublishItem, type QuickPublishStorage } from '../../../codocs/server/utils/companyAssetQuickPublish'
import { companyAssetPrefix } from './enterpriseCodocsCompanyAssets'

async function requirePublisher(event: H3Event) {
  const user = await requireEnterpriseUser(event)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'admin', 'admin', snapshot.actionPolicies?.admin)
    || !authorizationResourcesAllow(snapshot.resources, 'company', 'publish', snapshot.actionPolicies?.company)) {
    throw createError({ statusCode: 403, message: '缺少组织资产发布权限' })
  }
  return user
}

function positive(value: unknown, fallback: number, maximum: number) {
  if (value === undefined || value === '') return fallback
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > maximum) throw createError({ statusCode: 400, message: '分页参数无效' })
  return Number(value)
}

type PlanItem = QuickPublishItem & { bodyRef?: unknown }

// Runtime plans a converted (v2) department document with `bodyRef` and an
// empty `sourcePath`: its oss_path is only a possibly stale mirror. The exact
// published version is verified (length and SHA-256), staged under a
// content-addressed key and copied from there, so the company copy is exactly
// what was published. An item with neither reference nor path fails closed.
export async function exactQuickPublishSource(event: H3Event, client: QuickPublishStorage, item: PlanItem): Promise<QuickPublishItem> {
  const plain: QuickPublishItem = { sourceUuid: item.sourceUuid, sourcePath: item.sourcePath, title: item.title, newUuid: item.newUuid, ossPath: item.ossPath }
  const missing = () => createError({ statusCode: 503, message: '发布计划缺少文档正文来源，请稍后重试', data: { code: 'enterprise_document_body_ref_required' } })
  if (item.bodyRef === undefined || item.bodyRef === null) {
    if (typeof item.sourcePath === 'string' && item.sourcePath) return plain
    throw missing()
  }
  const { parseSnapshotHead, readSnapshotMarkdown } = await import('./enterpriseCodocsSnapshot')
  const head = parseSnapshotHead(item.bodyRef)
  if (head.generation === 0) {
    if (plain.sourcePath) return plain
    throw missing()
  }
  const bytes = Buffer.from(await readSnapshotMarkdown(event, head), 'utf8')
  const sourcePath = `codocs/copy-staging/quick-publish/${createHash('sha256').update(bytes).digest('hex')}.md`
  try {
    await client.put(sourcePath, bytes, { forbidOverwrite: true, headers: { 'content-type': 'text/markdown; charset=utf-8' }, meta: {} })
  } catch (error) {
    // Content-addressed: an existing object under this key has the same bytes.
    const conflict = error as { status?: number, statusCode?: number, code?: string }
    if (![409, 412].includes(conflict.status || conflict.statusCode || 0) && conflict.code !== 'FileAlreadyExists') {
      throw createError({ statusCode: 503, message: '发布源暂存失败，请使用相同请求重试' })
    }
  }
  return { ...plain, sourcePath }
}

export async function enterpriseCompanyQuickPublishSource(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requirePublisher(event)
  const query = getQuery(event)
  const params = getRequestURL(event).searchParams
  for (const [key, value] of Object.entries(query)) {
    if (!['deptCode', 'folderId', 'page', 'pageSize'].includes(key) || typeof value !== 'string' || params.getAll(key).length !== 1) throw createError({ statusCode: 400, message: '发布源查询无效' })
  }
  const deptCode = String(query.deptCode || '')
  if (deptCode && (!/^[A-Za-z0-9_-]{1,100}$/.test(deptCode))) throw createError({ statusCode: 400, message: '部门编码无效' })
  const folderId = query.folderId === undefined ? '' : String(query.folderId)
  if (folderId && !/^[1-9]\d*$/.test(folderId)) throw createError({ statusCode: 400, message: '目录标识无效' })
  const page = positive(query.page, 1, 1_000_000)
  const pageSize = positive(query.pageSize, 50, 100)
  const operation = 'codocs.company-asset-quick-publish-source' as const
  await prepareEnterpriseRuntime(event, operation)
  const [directory, response] = await Promise.all([
    fetchConsoleDirectoryApi<{ code: number, data?: { tree?: unknown[] } }>('/departments', { event }),
    callEnterpriseRuntime(event, operation, {
      tenant: user.tenant, deployment: user.deployment,
      query: { ...(deptCode ? { deptCode } : {}), ...(folderId ? { folderId } : {}), page: String(page), pageSize: String(pageSize) },
      authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'company-assets', action: 'publish', expiresAt: enterpriseRuntimePermitExpiresAt() }
    }) as Promise<{ success?: boolean, data?: { folders?: unknown[], documents?: unknown[], total?: number, page?: number, pageSize?: number } }>
  ])
  if (directory.code !== 0 || !Array.isArray(directory.data?.tree) || response?.success !== true || !Array.isArray(response.data?.folders) || !Array.isArray(response.data?.documents) || !Number.isSafeInteger(response.data?.total)) throw createError({ statusCode: 503, message: '发布源响应无效' })
  return { code: 0, data: { departments: directory.data, ...response.data } }
}

export async function enterpriseCompanyQuickPublish(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requirePublisher(event)
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || Object.keys(body).some(key => !['subdir', 'targetPath', 'documentUuids', 'operationId'].includes(key))) throw createError({ statusCode: 400, message: '发布请求无效' })
  const ids = body.documentUuids
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50 || ids.some(id => typeof id !== 'string' || !/^[a-fA-F0-9-]{36}$/.test(id)) || new Set(ids).size !== ids.length) throw createError({ statusCode: 400, message: '请选择 1 至 50 份部门文档' })
  const operationId = body.operationId
  if (typeof operationId !== 'string' || !/^[a-fA-F0-9-]{36}$/.test(operationId)) throw createError({ statusCode: 400, message: '发布操作标识无效' })
  const targetPrefix = companyAssetPrefix(String(body.subdir || ''), String(body.targetPath || ''))
  const prepareOperation = 'codocs.company-asset-quick-publish-prepare' as const
  const completeOperation = 'codocs.company-asset-quick-publish-complete' as const
  await prepareEnterpriseRuntime(event, prepareOperation)
  const input = { tenant: user.tenant, deployment: user.deployment,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'company-assets', action: 'publish', expiresAt: enterpriseRuntimePermitExpiresAt() } }
  const prepared = await callEnterpriseRuntime(event, prepareOperation, {
    ...input, payload: { operationId, targetPrefix, documentUuids: ids }
  }, { idempotencyKey: `codocs:company-publish:prepare:${operationId}` }) as { success?: boolean, data?: { plan?: { operationId: string, items: QuickPublishItem[] }, completed?: boolean, result?: Record<string, unknown> } }
  if (prepared?.success !== true || prepared.data?.plan?.operationId !== operationId || !Array.isArray(prepared.data.plan.items)) throw createError({ statusCode: 503, message: '发布计划响应无效' })
  if (prepared.data.completed) return { code: 0, data: prepared.data.result }
  const client = await createRuntimeOSSClient({ event }) as unknown as QuickPublishStorage
  const copies = []
  for (const item of prepared.data.plan.items) copies.push(await copyQuickPublishDocument(client, operationId, await exactQuickPublishSource(event, client, item)))
  // Storage copy can take time. Re-read the current Console authorization and
  // issue a fresh <=15s permit before completing the database transaction.
  const current = await requirePublisher(event)
  await prepareEnterpriseRuntime(event, completeOperation)
  const completed = await callEnterpriseRuntime(event, completeOperation, {
    tenant: current.tenant, deployment: current.deployment, payload: { operationId, copies },
    authorization: { actorUid: current.uid, tenant: current.tenant, deployment: current.deployment, resource: 'company-assets', action: 'publish', expiresAt: enterpriseRuntimePermitExpiresAt() }
  }, { idempotencyKey: `codocs:company-publish:complete:${operationId}` }) as { success?: boolean, data?: Record<string, unknown> }
  if (completed?.success !== true || !completed.data) throw createError({ statusCode: 503, message: '发布完成响应无效' })
  return { code: 0, data: completed.data }
}
