/**
 * 导出需求规格书（生成 Markdown）
 * GET /api/v1/projects/:id/requirements/export?version=v1.2
 */
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { buildAimsProjectRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface ContentRow {
  id: number
  parentId: number | null
  headingDepth: number
  title: string
  contentMd: string | null
  sortOrder: number
  status: string
  requirementId: number | null
}

interface ReqRow {
  id: number
  reqCode: string
  status: string
}

interface ExportData {
  projectName: string
  contents: ContentRow[]
  requirements: ReqRow[]
}

interface ContentNode {
  id: number
  title: string
  headingDepth: number
  contentMd: string | null
  status: string
  requirementId: number | null
  children: ContentNode[]
}

function buildTree(rows: ContentRow[]): ContentNode[] {
  const map = new Map<number, ContentNode>()
  const roots: ContentNode[] = []

  for (const row of rows) {
    map.set(row.id, {
      id: row.id,
      title: row.title,
      headingDepth: row.headingDepth,
      contentMd: row.contentMd,
      status: row.status,
      requirementId: row.requirementId,
      children: []
    })
  }

  for (const row of rows) {
    const node = map.get(row.id)!
    if (row.parentId && map.has(row.parentId)) {
      map.get(row.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

function stripPrefix(title: string): string {
  return title
    .replace(/^[一二三四五六七八九十百千零〇]+[、.]\s*/, '')
    .replace(/^\d+(\.\d+)*[、.\s]+\s*/, '')
    .trim()
}

function generateMarkdown(
  nodes: ContentNode[],
  reqMap: Map<number, string>,
  parentNumber: string
): string {
  let md = ''

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    const num = parentNumber ? `${parentNumber}.${i + 1}` : `${i + 1}`
    const prefix = '#'.repeat(node.headingDepth)

    if (node.status === 'deprecated') continue

    md += `${prefix} ${num} ${stripPrefix(node.title)}\n\n`

    if (node.requirementId && reqMap.has(node.requirementId)) {
      md += `> 需求编号: ${reqMap.get(node.requirementId)}\n\n`
    }

    if (node.contentMd?.trim()) {
      md += `${node.contentMd.trim()}\n\n`
    }

    if (node.children.length > 0) {
      md += generateMarkdown(node.children, reqMap, num)
    }
  }

  return md
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

  const projectId = Number(getRouterParam(event, 'id'))
  if (!projectId || Number.isNaN(projectId)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  const query = getQuery(event)
  const version = String(query.version || 'v1.0')

  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<ExportData>>(
    event,
    `/v1/aims/projects/${projectId}/requirements/export-data`,
    {
      appCode: 'aims',
      scope: 'aims.read',
      method: 'GET',
      query: await buildAimsProjectRuntimeAccessQuery(event, { projectId, uid })
    }
  )
  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Aims tenant-runtime is required for requirements export.'
    })
  }
  const exportData = unwrapRuntimeData(runtime.data)
  const contents = exportData.contents || []

  const reqMap = new Map<number, string>()
  for (const r of exportData.requirements || []) {
    if (r.status !== 'deprecated') {
      reqMap.set(r.id, r.reqCode)
    }
  }

  const tree = buildTree(contents)
  const projectName = exportData.projectName || '项目'
  const docTitle = `# ${projectName} - 需求规格书 ${version}\n\n`
  const body = generateMarkdown(tree, reqMap, '')
  const markdown = docTitle + body

  setResponseHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${encodeURIComponent(`${projectName}-需求规格书-${version}.md`)}"`)

  return markdown
})
