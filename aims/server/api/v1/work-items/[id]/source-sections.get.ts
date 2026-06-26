/**
 * 获取工作项的源文档章节原文（按锚点懒加载）
 * GET /api/v1/work-items/:id/source-sections
 *
 * 供工作项详情页的 SourceSectionViewer 组件使用。
 * 对每个锚点调用 Codocs 拉取该章节原文，支持断链降级。
 */
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { getCodocsDocumentContent } from '~~/server/utils/codocsApi'
import { extractSection } from '~~/server/utils/markdownOutline'

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
      query: { current_user: uid }
    }
  )
  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Aims tenant-runtime is required for source sections.'
    })
  }
  const anchors = unwrapRuntimeData(runtime.data).anchors || []

  if (anchors.length === 0) {
    return { code: 0, data: { sections: [] } }
  }

  // 按 source_document_uuid 分组，减少重复拉取
  const docCache = new Map<string, { content: string, title: string, updatedAt: string } | null>()

  const sections: SectionResult[] = []

  for (const anchor of anchors) {
    let doc = docCache.get(anchor.sourceDocumentUuid)
    if (doc === undefined) {
      try {
        const res = await getCodocsDocumentContent(anchor.sourceDocumentUuid, uid, event)
        doc = res?.data
          ? {
              content: res.data.content || '',
              title: res.data.title,
              updatedAt: res.data.updated_at
            }
          : null
      } catch (error: unknown) {
        console.warn('[source-sections] Failed to load doc:', anchor.sourceDocumentUuid, (error as Error).message)
        doc = null
      }
      docCache.set(anchor.sourceDocumentUuid, doc)
    }

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
