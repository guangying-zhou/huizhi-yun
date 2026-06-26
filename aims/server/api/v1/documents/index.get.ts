/**
 * 获取文档列表（树形结构）
 * GET /api/v1/documents?portfolio_id=&project_id=&milestone_id=&work_item_id=&parent_id=
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface DocumentRow extends RowDataPacket {
  id: number
  uuid: string
  portfolio_id: number | null
  project_id: number | null
  project_code: string | null
  milestone_id: number | null
  work_item_id: number | null
  parent_id: number | null
  title: string
  doc_category: string | null
  is_folder: number
  oss_path: string | null
  codocs_uuid: string | null
  content_size: number
  sort_order: number
  created_by: string
  updated_by: string | null
  created_at: string
  updated_at: string
}

interface DocumentItem {
  id: number
  uuid: string
  portfolioId: number | null
  projectId: number | null
  projectCode: string | null
  milestoneId: number | null
  workItemId: number | null
  parentId: number | null
  title: string
  docCategory: string | null
  isFolder: boolean
  ossPath: string | null
  codocsUuid: string | null
  contentSize: number
  sortOrder: number
  createdBy: string
  updatedBy: string | null
  createdAt: string
  updatedAt: string
  children?: DocumentItem[]
}

function toItem(row: DocumentRow): DocumentItem {
  return {
    id: row.id,
    uuid: row.uuid,
    portfolioId: row.portfolio_id,
    projectId: row.project_id,
    projectCode: row.project_code,
    milestoneId: row.milestone_id,
    workItemId: row.work_item_id,
    parentId: row.parent_id,
    title: row.title,
    docCategory: row.doc_category,
    isFolder: Boolean(row.is_folder),
    ossPath: row.oss_path,
    codocsUuid: row.codocs_uuid,
    contentSize: row.content_size,
    sortOrder: row.sort_order,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function buildTree(items: DocumentItem[]): DocumentItem[] {
  const map = new Map<number, DocumentItem>()
  const roots: DocumentItem[] = []

  for (const item of items) {
    item.children = []
    map.set(item.id, item)
  }

  for (const item of items) {
    if (item.parentId && map.has(item.parentId)) {
      map.get(item.parentId)!.children!.push(item)
    } else {
      roots.push(item)
    }
  }

  return roots
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const query = getQuery(event)

  const conditions: string[] = []
  const params: unknown[] = []

  if (query.portfolio_id) {
    conditions.push('d.portfolio_id = ?')
    params.push(Number(query.portfolio_id))
  }

  if (query.project_id) {
    conditions.push('d.project_id = ?')
    params.push(Number(query.project_id))
  }

  if (query.project_code) {
    conditions.push('d.project_code = ?')
    params.push(query.project_code)
  }

  if (query.milestone_id) {
    conditions.push('d.milestone_id = ?')
    params.push(Number(query.milestone_id))
  }

  if (query.work_item_id) {
    conditions.push('d.work_item_id = ?')
    params.push(Number(query.work_item_id))
  }

  if (query.parent_id) {
    conditions.push('d.parent_id = ?')
    params.push(Number(query.parent_id))
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const sql = `
    SELECT d.*
    FROM project_documents d
    ${whereClause}
    ORDER BY d.is_folder DESC, d.sort_order ASC, d.created_at ASC
  `
  const rows = await queryRows<DocumentRow[]>(sql, params)
  const items = rows.map(toItem)
  const tree = buildTree(items)

  return {
    code: 0,
    data: tree
  }
})
