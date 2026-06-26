/**
 * 获取需求分解页的初始化上下文
 * GET /api/v1/work-items/:id/decompose-context
 *
 * 只允许在 template_key ∈ {requirement_breakdown, requirement_change} 的工作项上调用
 * 返回：
 *   - 源工作项信息（project/milestone）
 *   - 源文档候选列表：从 Codocs 按项目组拉取
 *     候选项目组来源：
 *       1. aims_projects.portfolio_id → project_portfolios.git_group
 *       2. aims_project_repos.repo_project_code（所有关联仓库）
 *   - 已分解锚点集合（用于增量分解的 diff）
 */
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { listCodocsProjectGroupDocuments } from '~~/server/utils/codocsApi'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface SourceItemRow {
  id: number
  projectId: number
  projectCode: string
  projectName: string
  milestoneId: number
  milestoneName: string
  itemKey: string
  title: string
  tier: string
  type: string
  templateKey: string | null
  status: string
  approvalStatus: string
  reviewLevel: number
}

interface ExistingAnchorRow {
  anchor: string
  sourceDocumentUuid: string
  sourceDocumentTitle: string
  headingDepth: number
  workItemId: number
  workItemKey: string
  workItemTier: string
  workItemParentId: number | null
  workItemRequirementCategory: string | null
}

interface RuntimeDecomposeContextData {
  workItem: SourceItemRow
  sourceProjectCodes: string[]
  existingAnchors: ExistingAnchorRow[]
}

function unwrapRuntimeData<T>(value: RuntimeEnvelope<T>): T {
  if (value.code !== undefined && value.code !== 0) {
    throw createError({ statusCode: 502, message: value.message || 'Aims tenant-runtime returned an error.' })
  }
  return value.data as T
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const workItemId = Number(getRouterParam(event, 'id'))
  if (!workItemId || Number.isNaN(workItemId)) {
    throw createError({ statusCode: 400, message: '无效的工作项ID' })
  }

  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<RuntimeDecomposeContextData>>(
    event,
    `/v1/aims/work-items/${workItemId}/decompose-context-data`,
    {
      appCode: 'aims',
      scope: 'aims.read',
      method: 'GET',
      query: { current_user: uid }
    }
  )
  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Aims tenant-runtime is required for decompose context.'
    })
  }
  const runtimeData = unwrapRuntimeData(runtime.data)
  const item = runtimeData.workItem
  const candidateCodes = new Set(runtimeData.sourceProjectCodes.map(code => code.trim()).filter(Boolean))

  // 从 Codocs 拉取每个候选项目组下的文档（并发），union 去重
  const docsByUuid = new Map<string, {
    codocsUuid: string
    title: string
    ownerUid: string
    projectCode: string | null
    folderId: number | null
    updatedAt: string
    sourceProjectCode: string
  }>()

  if (candidateCodes.size > 0) {
    const results = await Promise.allSettled(
      Array.from(candidateCodes).map(code => listCodocsProjectGroupDocuments(code, uid))
    )
    const codes = Array.from(candidateCodes)
    results.forEach((res, idx) => {
      if (res.status !== 'fulfilled') {
        console.warn('[decompose-context] failed to fetch codocs project group docs:', codes[idx], (res.reason as Error)?.message)
        return
      }
      const list = res.value?.data || []
      for (const entry of list) {
        const d = entry.data
        if (!d?.uuid || docsByUuid.has(d.uuid)) continue
        docsByUuid.set(d.uuid, {
          codocsUuid: d.uuid,
          title: d.title,
          ownerUid: d.owner_uid,
          projectCode: d.project_code,
          folderId: d.folder_id,
          updatedAt: d.updated_at,
          sourceProjectCode: codes[idx]!
        })
      }
    })
  }

  const docs = Array.from(docsByUuid.values())
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))

  return {
    code: 0,
    data: {
      workItem: {
        id: item.id,
        itemKey: item.itemKey,
        title: item.title,
        tier: item.tier,
        type: item.type,
        templateKey: item.templateKey,
        status: item.status,
        approvalStatus: item.approvalStatus,
        reviewLevel: item.reviewLevel,
        projectId: item.projectId,
        projectCode: item.projectCode,
        projectName: item.projectName,
        milestoneId: item.milestoneId,
        milestoneName: item.milestoneName
      },
      sourceProjectCodes: Array.from(candidateCodes),
      sourceDocumentCandidates: docs.map(d => ({
        codocsUuid: d.codocsUuid,
        title: d.title,
        ownerUid: d.ownerUid,
        projectCode: d.projectCode,
        sourceProjectCode: d.sourceProjectCode,
        updatedAt: d.updatedAt
      })),
      existingAnchors: runtimeData.existingAnchors
    }
  }
})
