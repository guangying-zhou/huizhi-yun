import { randomUUID } from 'node:crypto'
import { requirePermission } from '~~/server/utils/checkPermission'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { buildCompanyAssetPrefix } from '~~/server/utils/assetOssPath'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { createRuntimeOSSClient } from '~~/server/utils/oss'
import { copyQuickPublishDocument, type QuickPublishItem, type QuickPublishStorage } from '~~/server/utils/companyAssetQuickPublish'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin', 'admin', '仅系统管理员可直接发布组织资产')
  await requirePermission(event, 'company', 'publish', '缺少组织资产发布权限')
  const actor = requireRequestUid(event)
  const body = await readBody(event)
  const categories = ['rules', 'culture', 'legal', 'notices', 'knowledge', 'tech-specs', 'templates']
  if (!categories.includes(body?.subdir) || !Array.isArray(body.documentUuids) || !body.documentUuids.length || body.documentUuids.length > 50) {
    throw createError({ statusCode: 400, message: '请选择组织资产分类和 1 至 50 份部门文档' })
  }
  const targetPrefix = buildCompanyAssetPrefix(body.subdir, body.targetPath)
  const operationId = String(body.operationId || randomUUID())
  const query = { current_user: actor, codocs_trusted_company_quick_publish: '1' }
  const prepared = await callCodocsTenantRuntime<{
    plan: { operationId: string, items: QuickPublishItem[] }
    completed: boolean
    result?: Record<string, unknown>
  }>(event, '/v1/codocs/company-assets/quick-publish/prepare', {
    method: 'POST', query,
    body: { operationId, targetPrefix, documentUuids: body.documentUuids }
  })
  if (prepared.completed) return { code: 0, data: prepared.result }
  const client = await createRuntimeOSSClient({ event }) as unknown as QuickPublishStorage
  const copies = []
  for (const item of prepared.plan.items) copies.push(await copyQuickPublishDocument(client, operationId, item))
  const result = await callCodocsTenantRuntime<Record<string, unknown>>(event, '/v1/codocs/company-assets/quick-publish/complete', {
    method: 'POST', query, body: { operationId, copies }
  })
  return { code: 0, data: result }
})
