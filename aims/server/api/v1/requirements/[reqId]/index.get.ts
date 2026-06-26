/**
 * 获取单条需求详情
 * GET /api/v1/requirements/:reqId
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface ReqRow extends RowDataPacket {
  id: number
  item_kind: string
  parent_requirement_id: number | null
  change_no: number | null
  change_reason: string | null
  project_id: number
  req_number: number
  req_code: string
  title: string
  type: string
  category: string | null
  priority: string
  source: string
  scope_note: string | null
  milestone_id: number | null
  status: string
  current_version: number
  baselined_at: string | null
  created_by: string
  created_at: string
  updated_by: string | null
  updated_at: string
  milestone_name: string | null
}

interface ContentRow extends RowDataPacket {
  id: number
  content_original_id: number | null
  display_parent_id: number | null
  source_parent_id: number | null
  title: string
  heading_depth: number
  sort_order: number
  status: string
  content_md: string | null
  relation_sort_order: number | null
}

interface ContextModuleRow extends RowDataPacket {
  id: number
  title: string
  heading_depth: number
  sort_order: number
  content_md: string | null
}

interface TaskRow extends RowDataPacket {
  id: number
  item_key: string
  title: string
  status: string
  assignee_uid: string | null
  type: string
  change_request_of: number | null
}

interface VersionRow extends RowDataPacket {
  id: number
  version_no: number
  change_type: string
  change_reason: string | null
  approved_by: string | null
  approved_at: string | null
  created_by: string
  created_at: string
}

interface ParentReqRow extends RowDataPacket {
  id: number
  req_code: string
  title: string
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const reqId = Number(getRouterParam(event, 'reqId'))
  if (!reqId || Number.isNaN(reqId)) {
    throw createError({ statusCode: 400, message: '无效的需求ID' })
  }

  const req = await queryRow<ReqRow>(
    `SELECT r.*, m.name AS milestone_name
     FROM requirement_items r
     LEFT JOIN milestones m ON m.id = r.milestone_id
     WHERE r.id = ?`,
    [reqId]
  )
  if (!req) {
    throw createError({ statusCode: 404, message: '需求不存在' })
  }

  let parentRequirement: ParentReqRow | null = null
  if (req.parent_requirement_id) {
    parentRequirement = await queryRow<ParentReqRow>(
      `SELECT id, req_code, title
       FROM requirement_items
       WHERE id = ?`,
      [req.parent_requirement_id]
    )
  }

  const relationType = req.item_kind === 'change' ? 'change' : 'baseline'
  const visibleVersionStatuses = relationType === 'change'
    ? '\'baselined\', \'change_draft\', \'in_review\''
    : '\'draft\', \'baselined\''
  const contents = await queryRows<ContentRow[]>(
    `WITH RECURSIVE content_scope AS (
       SELECT c.id, c.content_original_id, CAST(NULL AS UNSIGNED) AS display_parent_id, c.parent_id AS source_parent_id,
              c.title, c.heading_depth, c.sort_order,
              c.status, c.content_md, ric.sort_order AS relation_sort_order,
              CAST(CONCAT(LPAD(COALESCE(ric.sort_order, c.sort_order), 10, '0'), '.', LPAD(c.id, 10, '0')) AS CHAR(2000)) AS sort_path,
              CAST(CONCAT(',', c.id, ',') AS CHAR(2000)) AS path_ids
       FROM requirement_contents c
       LEFT JOIN requirement_item_contents ric
         ON ric.content_id = c.id
        AND ric.requirement_id = ?
        AND ric.relation_type = ?
       WHERE ric.id IS NOT NULL
         AND c.version_status IN (${visibleVersionStatuses})

       UNION ALL

       SELECT child.id, child.content_original_id, scope.id AS display_parent_id, child.parent_id AS source_parent_id,
              child.title, child.heading_depth,
              child.sort_order, child.status, child.content_md,
              scope.relation_sort_order,
              CONCAT(scope.sort_path, '.', LPAD(child.sort_order, 10, '0'), '.', LPAD(child.id, 10, '0')) AS sort_path,
              CONCAT(scope.path_ids, child.id, ',') AS path_ids
       FROM requirement_contents child
       INNER JOIN requirement_contents parent_version ON parent_version.id = child.parent_id
       INNER JOIN content_scope scope
         ON COALESCE(parent_version.content_original_id, parent_version.id) = COALESCE(scope.content_original_id, scope.id)
       WHERE child.project_id = ?
         AND child.version_status IN (${visibleVersionStatuses})
         AND LOCATE(CONCAT(',', child.id, ','), scope.path_ids) = 0
     )
     SELECT id, content_original_id, display_parent_id, source_parent_id, title, heading_depth, sort_order, status, content_md, relation_sort_order
     FROM (
       SELECT content_scope.*,
              ROW_NUMBER() OVER (PARTITION BY id ORDER BY sort_path) AS rn
       FROM content_scope
     ) ranked
     WHERE rn = 1
     ORDER BY sort_path`,
    [reqId, relationType, req.project_id]
  )
  const contextModuleIds = [...new Set(
    contents
      .map(c => c.source_parent_id)
      .filter((id): id is number => !!id && !contents.some(item => item.id === id))
  )]
  let contextModules: ContextModuleRow[] = []
  if (contextModuleIds.length > 0) {
    contextModules = await queryRows<ContextModuleRow[]>(
      `SELECT id, title, heading_depth, sort_order, content_md
       FROM requirement_contents
       WHERE id IN (${contextModuleIds.map(() => '?').join(',')})
       ORDER BY sort_order, id`,
      contextModuleIds
    )
  }

  const tasks = await queryRows<TaskRow[]>(
    `SELECT id, item_key, title, status, assignee_uid, type, change_request_of
     FROM work_items
     WHERE requirement_id = ?
     ORDER BY created_at`,
    [reqId]
  )

  const versions = await queryRows<VersionRow[]>(
    `SELECT id, version_no, change_type, change_reason, approved_by, approved_at, created_by, created_at
     FROM requirement_versions
     WHERE requirement_id = ?
     ORDER BY version_no DESC`,
    [reqId]
  )

  return {
    code: 0,
    data: {
      id: req.id,
      itemKind: req.item_kind,
      parentRequirementId: req.parent_requirement_id,
      changeNo: req.change_no,
      changeReason: req.change_reason,
      projectId: req.project_id,
      reqNumber: req.req_number,
      reqCode: req.req_code,
      title: req.title,
      type: req.type,
      category: req.category,
      priority: req.priority,
      source: req.source,
      scopeNote: req.scope_note,
      milestoneId: req.milestone_id,
      milestoneName: req.milestone_name,
      status: req.status,
      currentVersion: req.current_version,
      baselinedAt: req.baselined_at,
      createdBy: req.created_by,
      createdAt: req.created_at,
      updatedBy: req.updated_by,
      updatedAt: req.updated_at,
      parentRequirement: parentRequirement
        ? {
            id: parentRequirement.id,
            reqCode: parentRequirement.req_code,
            title: parentRequirement.title
          }
        : null,
      contents: contents.map(c => ({
        id: c.id,
        parentId: c.display_parent_id,
        sourceParentId: c.source_parent_id,
        title: c.title,
        headingDepth: c.heading_depth,
        sortOrder: c.sort_order,
        status: c.status,
        contentMd: c.content_md
      })),
      contextModules: contextModules.map(module => ({
        id: module.id,
        title: module.title,
        headingDepth: module.heading_depth,
        sortOrder: module.sort_order,
        contentMd: module.content_md
      })),
      tasks: tasks.map(t => ({
        id: t.id,
        itemKey: t.item_key,
        title: t.title,
        status: t.status,
        assigneeUid: t.assignee_uid,
        type: t.type,
        changeRequestOf: t.change_request_of
      })),
      versions: versions.map(v => ({
        id: v.id,
        versionNo: v.version_no,
        changeType: v.change_type,
        changeReason: v.change_reason,
        approvedBy: v.approved_by,
        approvedAt: v.approved_at,
        createdBy: v.created_by,
        createdAt: v.created_at
      }))
    }
  }
})
