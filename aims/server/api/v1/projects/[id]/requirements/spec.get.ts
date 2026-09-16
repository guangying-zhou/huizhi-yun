/**
 * 获取需求规格书元信息 + 章节树
 * GET /api/v1/projects/:id/requirements/spec
 */
import { listAllAimsRuntime, nullableNumberValue, numberValue, stringValue } from '~~/server/utils/aimsRuntimePages'
import { buildAimsProjectRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'

interface RuntimeDocument {
  id?: number
  uuid?: string
  title?: string
  codocs_uuid?: string | null
  import_mode?: string | null
  heading_levels?: string | null
  import_status?: string | null
}

interface RuntimeContent {
  id?: number
  content_original_id?: number | null
  version_no?: number
  version_status?: string
  parent_id?: number | null
  heading_depth?: number
  title?: string
  sort_order?: number
  status?: string
  content_md?: string | null
  created_at?: string
}

interface RuntimeRequirement {
  id?: number
  req_code?: string
  title?: string
  status?: string
  created_at?: string
}

interface RuntimeContentRelation {
  requirement_id?: number
  relation_type?: string
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const projectId = Number(getRouterParam(event, 'id'))
  if (!projectId || Number.isNaN(projectId)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }
  const query = getQuery(event)
  const includeDeleted = query.include_deleted === '1' || query.include_deleted === 'true'
  const projectAccessQuery = await buildAimsProjectRuntimeAccessQuery(event, { projectId, uid })

  const specDoc = (await listAllAimsRuntime<RuntimeDocument>(
    event,
    `/v1/aims/projects/${encodeURIComponent(String(projectId))}/documents`,
    { doc_category: 'requirement_spec' }
  ))[0]

  if (!specDoc) {
    return {
      code: 0,
      data: {
        spec: null,
        contents: [],
        requirements: []
      }
    }
  }

  const contents = (await listAllAimsRuntime<RuntimeContent>(
    event,
    `/v1/aims/projects/${encodeURIComponent(String(projectId))}/requirement-contents`
  ))
    .filter(item => stringValue(item.version_status) === 'draft' || stringValue(item.version_status) === 'baselined')
    .filter(item => includeDeleted || stringValue(item.status) !== 'deprecated')
    .sort((a, b) => {
      const rootCompare = (nullableNumberValue(b.parent_id) === null ? 1 : 0) - (nullableNumberValue(a.parent_id) === null ? 1 : 0)
      if (rootCompare !== 0) return rootCompare
      const parentCompare = (nullableNumberValue(a.parent_id) || 0) - (nullableNumberValue(b.parent_id) || 0)
      if (parentCompare !== 0) return parentCompare
      return numberValue(a.sort_order) - numberValue(b.sort_order)
    })

  const linkedRequirementByContentId = await loadBaselineRelations(event, contents, projectAccessQuery)
  const reqIds = [...new Set([...linkedRequirementByContentId.values()].filter(Boolean))]
  const requirements = reqIds.length > 0
    ? (await listAllAimsRuntime<RuntimeRequirement>(
        event,
        `/v1/aims/projects/${encodeURIComponent(String(projectId))}/requirements`
      )).filter(item => reqIds.includes(numberValue(item.id)))
    : []

  return {
    code: 0,
    data: {
      spec: {
        id: numberValue(specDoc.id),
        uuid: stringValue(specDoc.uuid),
        title: stringValue(specDoc.title),
        codocsUuid: stringValue(specDoc.codocs_uuid) || null,
        importMode: stringValue(specDoc.import_mode) || null,
        headingLevels: stringValue(specDoc.heading_levels) || null,
        importStatus: stringValue(specDoc.import_status) || null
      },
      contents: contents.map(c => ({
        id: numberValue(c.id),
        contentOriginalId: nullableNumberValue(c.content_original_id),
        versionNo: numberValue(c.version_no),
        versionStatus: stringValue(c.version_status),
        parentId: nullableNumberValue(c.parent_id),
        headingDepth: numberValue(c.heading_depth),
        title: stringValue(c.title),
        sortOrder: numberValue(c.sort_order),
        status: stringValue(c.status),
        requirementId: linkedRequirementByContentId.get(numberValue(c.id)) || null,
        contentMd: stringValue(c.content_md) || null,
        createdAt: stringValue(c.created_at)
      })),
      requirements: requirements.map(r => ({
        id: numberValue(r.id),
        reqCode: stringValue(r.req_code),
        title: stringValue(r.title),
        status: stringValue(r.status),
        createdAt: stringValue(r.created_at)
      }))
    }
  }
})

async function loadBaselineRelations(
  event: Parameters<typeof listAllAimsRuntime>[0],
  contents: RuntimeContent[],
  projectAccessQuery: Record<string, unknown>
) {
  const result = new Map<number, number>()

  for (const content of contents) {
    const contentId = numberValue(content.id)
    if (!contentId) continue

    try {
      const relations = await listAllAimsRuntime<RuntimeContentRelation>(
        event,
        `/v1/aims/requirement-contents/${encodeURIComponent(String(contentId))}/relations`,
        { ...projectAccessQuery, relation_type: 'baseline' }
      )
      const requirementId = nullableNumberValue(relations[0]?.requirement_id)
      if (requirementId) result.set(contentId, requirementId)
    } catch (error) {
      console.warn('[RequirementSpec] failed to load content relation from tenant-runtime:', error)
      break
    }
  }

  return result
}
