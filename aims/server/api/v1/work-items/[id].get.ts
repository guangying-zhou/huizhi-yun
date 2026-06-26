/**
 * 获取工作项详情
 * GET /api/v1/work-items/:id
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { hasWorkItemStartDateColumn } from '~~/server/utils/workItemStartDate'

interface WorkItemRow extends RowDataPacket {
  id: number
  project_id: number
  milestone_id: number
  item_number: number
  item_key: string
  type: string
  title: string
  description: string | null
  start_date: string | null
  status: string
  priority: string
  severity: string | null
  weight: number
  assignee_uid: string | null
  reporter_uid: string | null
  due_date: string | null
  estimated_hours: number | null
  parent_id: number | null
  sort_order: number
  approval_status: string
  workflow_instance_id: string | null
  created_at: string
  updated_at: string
  milestone_name: string | null
}

interface CommentRow extends RowDataPacket {
  id: number
  work_item_id: number
  author_uid: string
  content: string
  created_at: string
  updated_at: string
}

interface ChangelogRow extends RowDataPacket {
  id: number
  work_item_id: number
  field_name: string
  old_value: string | null
  new_value: string | null
  changed_by: string
  changed_at: string
}

interface AttachmentRow extends RowDataPacket {
  id: number
  work_item_id: number
  file_name: string
  oss_key: string
  file_size: number
  content_type: string | null
  uploaded_by: string
  uploaded_at: string
}

interface RelationRow extends RowDataPacket {
  id: number
  source_id: number
  target_id: number
  relation_type: string
  created_at: string
  target_item_key: string
  target_title: string
}

interface CountRow extends RowDataPacket {
  child_count: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const workItemId = Number(getRouterParam(event, 'id'))
  if (!workItemId || isNaN(workItemId)) {
    throw createError({ statusCode: 400, message: '无效的工作项ID' })
  }

  const supportsStartDate = await hasWorkItemStartDateColumn()

  // 工作项主体
  const item = await queryRow<WorkItemRow>(
    `SELECT wi.*,
            ${supportsStartDate ? 'wi.start_date' : 'NULL AS start_date'},
            ml.name AS milestone_name
     FROM work_items wi
     LEFT JOIN milestones ml ON ml.id = wi.milestone_id
     WHERE wi.id = ?`,
    [workItemId]
  )
  if (!item) {
    throw createError({ statusCode: 404, message: '工作项不存在' })
  }

  // 并行查询关联数据
  const [comments, changelog, attachments, relations, childCount] = await Promise.all([
    queryRows<CommentRow[]>(
      'SELECT * FROM work_item_comments WHERE work_item_id = ? ORDER BY created_at DESC LIMIT 20',
      [workItemId]
    ),
    queryRows<ChangelogRow[]>(
      'SELECT * FROM work_item_changelog WHERE work_item_id = ? ORDER BY changed_at DESC LIMIT 20',
      [workItemId]
    ),
    queryRows<AttachmentRow[]>(
      'SELECT * FROM work_item_attachments WHERE work_item_id = ?',
      [workItemId]
    ),
    queryRows<RelationRow[]>(
      `SELECT r.*, t.item_key AS target_item_key, t.title AS target_title
       FROM work_item_relations r
       INNER JOIN work_items t ON t.id = r.target_id
       WHERE r.source_id = ?`,
      [workItemId]
    ),
    queryRow<CountRow>(
      'SELECT COUNT(*) AS child_count FROM work_items WHERE parent_id = ?',
      [workItemId]
    )
  ])

  return {
    code: 0,
    data: {
      id: item.id,
      projectId: item.project_id,
      milestoneId: item.milestone_id,
      itemNumber: item.item_number,
      itemKey: item.item_key,
      type: item.type,
      title: item.title,
      description: item.description,
      startDate: item.start_date,
      status: item.status,
      priority: item.priority,
      severity: item.severity,
      weight: item.weight,
      assigneeUid: item.assignee_uid,
      reporterUid: item.reporter_uid,
      dueDate: item.due_date,
      estimatedHours: item.estimated_hours,
      parentId: item.parent_id,
      sortOrder: item.sort_order,
      approvalStatus: item.approval_status,
      workflowInstanceId: item.workflow_instance_id,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      milestoneName: item.milestone_name,
      childCount: childCount?.child_count || 0,
      comments: comments.map(c => ({
        id: c.id,
        workItemId: c.work_item_id,
        authorUid: c.author_uid,
        content: c.content,
        createdAt: c.created_at,
        updatedAt: c.updated_at
      })),
      changelog: changelog.map(cl => ({
        id: cl.id,
        workItemId: cl.work_item_id,
        fieldName: cl.field_name,
        oldValue: cl.old_value,
        newValue: cl.new_value,
        changedBy: cl.changed_by,
        changedAt: cl.changed_at
      })),
      attachments: attachments.map(a => ({
        id: a.id,
        workItemId: a.work_item_id,
        fileName: a.file_name,
        ossKey: a.oss_key,
        fileSize: a.file_size,
        contentType: a.content_type,
        uploadedBy: a.uploaded_by,
        uploadedAt: a.uploaded_at
      })),
      relations: relations.map(r => ({
        id: r.id,
        sourceId: r.source_id,
        targetId: r.target_id,
        relationType: r.relation_type,
        createdAt: r.created_at,
        targetItemKey: r.target_item_key,
        targetTitle: r.target_title
      }))
    }
  }
})
