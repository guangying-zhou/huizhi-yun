/**
 * 获取工作项的源文档章节原文（按锚点懒加载）
 * GET /api/v1/work-items/:id/source-sections
 *
 * 供工作项详情页的 SourceSectionViewer 组件使用。
 * 按文档去重后有界并发拉取 Codocs 原文，支持断链降级。
 */
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { getCodocsProjectDocumentContent } from '~~/server/utils/codocsApi'
import { extractSection } from '~~/server/utils/markdownOutline'
import { buildAimsProjectListRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'
import { assertCodocsProjectDocumentAccess } from '~~/server/utils/projectDocumentAccess'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface AnchorRow {
  id: number
  sourceDocumentUuid: string
  sourceDocumentTitle: string
  headingAnchor: string
  headingDepth: number
  sortOrder: number
}

interface SourceSectionRuntimeData {
  projectId?: number
  project_id?: number
  anchors: AnchorRow[]
}

interface SectionResult {
  anchorId: number
  sourceDocumentUuid: string
  sourceDocumentTitle: string
  headingAnchor: string
  headingDepth: number
  sortOrder: number
  missing: boolean
  reason?: 'document_not_found' | 'anchor_not_found'
  title?: string
  markdown?: string
  updatedAt?: string
}

const SOURCE_DOCUMENT_CONCURRENCY = 4

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

  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<SourceSectionRuntimeData>>(
    event,
    `/v1/aims/work-items/${workItemId}/source-sections-data`,
    {
      appCode: 'aims',
      scope: 'aims.read',
      method: 'GET',
      query: await buildAimsProjectListRuntimeAccessQuery(event, { uid })
    }
  )
  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Aims tenant-runtime is required for source sections.'
    })
  }
  const runtimeData = unwrapRuntimeData(runtime.data)
  const projectId = Number(runtimeData.projectId ?? runtimeData.project_id) || 0
  const anchors = runtimeData.anchors || []

  if (anchors.length === 0) {
    return { code: 0, data: { sections: [] } }
  }
  if (!projectId) {
    throw createError({ statusCode: 502, message: 'Aims tenant-runtime did not return source section project context.' })
  }

  // 专用 Codocs service-command 逐文档绑定 UUID 和 ACL，不能退回已废弃的通用批量读取。
  // 这里按 UUID 去重并限制并发，既缩短多个源文档的等待时间，也避免无界外呼。
  const docCache = new Map<string, { content: string, title: string, updatedAt: string } | null>()
  const documentUuids = [...new Set(anchors.map(anchor => anchor.sourceDocumentUuid))]
  let nextDocumentIndex = 0

  async function loadDocuments() {
    while (nextDocumentIndex < documentUuids.length) {
      const documentUuid = documentUuids[nextDocumentIndex++]!
      try {
        const access = await assertCodocsProjectDocumentAccess(event, projectId, documentUuid, uid)
        const res = await getCodocsProjectDocumentContent({
          event,
          actorUid: uid,
          projectCode: access.projectCode,
          documentUuid
        })
        docCache.set(documentUuid, res?.data
          ? {
              content: res.data.content || '',
              title: res.data.title,
              updatedAt: res.data.updated_at
            }
          : null)
      } catch (error: unknown) {
        console.warn('[source-sections] Failed to load doc:', documentUuid, (error as Error).message)
        docCache.set(documentUuid, null)
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(SOURCE_DOCUMENT_CONCURRENCY, documentUuids.length) },
      () => loadDocuments()
    )
  )

  const sections: SectionResult[] = []

  for (const anchor of anchors) {
    const doc = docCache.get(anchor.sourceDocumentUuid) || null

    if (!doc) {
      sections.push({
        anchorId: anchor.id,
        sourceDocumentUuid: anchor.sourceDocumentUuid,
        sourceDocumentTitle: anchor.sourceDocumentTitle,
        headingAnchor: anchor.headingAnchor,
        headingDepth: anchor.headingDepth,
        sortOrder: anchor.sortOrder,
        missing: true,
        reason: 'document_not_found'
      })
      continue
    }

    const section = extractSection(doc.content, anchor.headingAnchor)
    if (!section) {
      sections.push({
        anchorId: anchor.id,
        sourceDocumentUuid: anchor.sourceDocumentUuid,
        sourceDocumentTitle: anchor.sourceDocumentTitle,
        headingAnchor: anchor.headingAnchor,
        headingDepth: anchor.headingDepth,
        sortOrder: anchor.sortOrder,
        missing: true,
        reason: 'anchor_not_found',
        updatedAt: doc.updatedAt
      })
    } else {
      sections.push({
        anchorId: anchor.id,
        sourceDocumentUuid: anchor.sourceDocumentUuid,
        sourceDocumentTitle: doc.title || anchor.sourceDocumentTitle,
        headingAnchor: anchor.headingAnchor,
        headingDepth: anchor.headingDepth,
        sortOrder: anchor.sortOrder,
        missing: false,
        title: section.title,
        markdown: section.markdown,
        updatedAt: doc.updatedAt
      })
    }
  }

  return { code: 0, data: { sections } }
})
