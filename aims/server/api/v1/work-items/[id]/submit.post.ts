/**
 * 提交工作项分解审批
 * POST /api/v1/work-items/:id/submit
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { hasWorkItemStartDateColumn } from '~~/server/utils/workItemStartDate'

interface ItemRow extends RowDataPacket {
  id: number
  project_id: number
  project_code: string
  item_key: string
  title: string
  description: string | null
  start_date: string | null
  due_date: string | null
  assignee_uid: string | null
  approval_status: string
}

interface ChildRow extends RowDataPacket {
  id: number
  title: string
  description: string | null
  start_date: string | null
  due_date: string | null
  assignee_uid: string | null
}

interface DeliverableRow extends RowDataPacket {
  target_id: number | null
  matter_id: number | null
  name: string
  acceptance_criteria: string | null
}

function compareDate(a: string, b: string) {
  return new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()
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

  const body = await readBody<{ reviewerUid?: string, requestComment?: string | null }>(event)
  if (!body.reviewerUid) {
    throw createError({ statusCode: 400, message: '请选择审核人' })
  }

  const supportsStartDate = await hasWorkItemStartDateColumn()

  const item = await queryRow<ItemRow>(
    `SELECT wi.id, wi.project_id, p.project_code, wi.item_key, wi.title, wi.description,
            ${supportsStartDate ? 'wi.start_date' : 'NULL AS start_date'},
            wi.due_date, wi.assignee_uid, wi.approval_status
     FROM work_items wi
     JOIN aims_projects p ON p.id = wi.project_id
     WHERE wi.id = ?`,
    [workItemId]
  )
  if (!item) {
    throw createError({ statusCode: 404, message: '工作项不存在' })
  }
  if (item.approval_status === 'pending') {
    throw createError({ statusCode: 400, message: '当前工作项已提交审批' })
  }

  const children = await queryRows<ChildRow[]>(
    `SELECT id, title, description, ${supportsStartDate ? 'start_date' : 'NULL AS start_date'}, due_date, assignee_uid
     FROM work_items
     WHERE parent_id = ?
     ORDER BY sort_order ASC, created_at ASC`,
    [workItemId]
  )

  // 本目标自身的成果要求 + 各 child matter 的成果（承接 + 中间产物）
  const deliverables = await queryRows<DeliverableRow[]>(
    `SELECT target_id, matter_id, name, acceptance_criteria
     FROM deliverables
     WHERE project_id = ?
       AND (
         target_id = ?
         OR matter_id IN (SELECT id FROM work_items WHERE parent_id = ?)
       )`,
    [item.project_id, workItemId, workItemId]
  )

  // 分桶规则：
  //   - matter_id 命中某个 child → 归入 child（承接行 + 中间产物都在这里校验）
  //   - 否则（仅 target_id = workItemId 的未分配要求行）→ 归入 workItemId
  const childIds = new Set(children.map(c => c.id))
  const deliverableMap = new Map<number, DeliverableRow[]>()
  for (const deliverable of deliverables) {
    const bucketId = deliverable.matter_id && childIds.has(deliverable.matter_id)
      ? deliverable.matter_id
      : deliverable.target_id
    if (!bucketId) continue
    const list = deliverableMap.get(bucketId) || []
    list.push(deliverable)
    deliverableMap.set(bucketId, list)
  }

  if (children.length === 0) {
    if (!item.assignee_uid) {
      throw createError({ statusCode: 400, message: '直接指派模式下必须指定负责人' })
    }
    if (!item.description?.trim()) {
      throw createError({ statusCode: 400, message: '直接指派模式下必须填写执行说明' })
    }
    if (!item.start_date || !item.due_date || compareDate(item.start_date, item.due_date) > 0) {
      throw createError({ statusCode: 400, message: '直接指派模式下必须填写合法的开始/结束日期' })
    }
    const currentDeliverables = deliverableMap.get(workItemId) || []
    if (currentDeliverables.length === 0 || !currentDeliverables[0]?.name?.trim() || !currentDeliverables[0]?.acceptance_criteria?.trim()) {
      throw createError({ statusCode: 400, message: '直接指派模式下必须填写成果要求和验收标准' })
    }
  } else {
    if (!item.start_date || !item.due_date || compareDate(item.start_date, item.due_date) > 0) {
      throw createError({ statusCode: 400, message: '请先为当前目标设置合法的开始/结束日期' })
    }
    for (const [index, child] of children.entries()) {
      if (!child.description?.trim()) {
        throw createError({ statusCode: 400, message: `分项 ${index + 1} 缺少具体描述` })
      }
      if (!child.assignee_uid) {
        throw createError({ statusCode: 400, message: `分项 ${index + 1} 缺少负责人` })
      }
      if (!child.start_date || !child.due_date || compareDate(child.start_date, child.due_date) > 0) {
        throw createError({ statusCode: 400, message: `分项 ${index + 1} 缺少合法日期` })
      }
      if (compareDate(child.start_date, item.start_date) < 0 || compareDate(child.due_date, item.due_date) > 0) {
        throw createError({ statusCode: 400, message: `分项 ${index + 1} 日期超出当前目标范围` })
      }
      const childDeliverables = deliverableMap.get(child.id) || []
      if (childDeliverables.length === 0 || !childDeliverables[0]?.name?.trim() || !childDeliverables[0]?.acceptance_criteria?.trim()) {
        throw createError({ statusCode: 400, message: `分项 ${index + 1} 缺少成果要求或验收标准` })
      }
    }
  }

  await execute(
    `INSERT INTO approval_records
      (project_owner_id, milestone_owner_id, work_item_owner_id,
       entity_code, transition, title,
       requested_by, request_comment, reviewer_uid, status,
       project_id, project_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      null,
      null,
      workItemId,
      item.item_key,
      'submit_breakdown',
      `${item.item_key} 工作目标分解提交`,
      uid,
      body.requestComment || null,
      body.reviewerUid,
      item.project_id,
      item.project_code
    ]
  )

  await execute(
    'UPDATE work_items SET approval_status = ? WHERE id = ?',
    ['pending', workItemId]
  )

  return {
    code: 0,
    data: null
  }
})
