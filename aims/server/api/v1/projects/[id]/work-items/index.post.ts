/**
 * 创建工作项
 * POST /api/v1/projects/:id/work-items
 */
import type { RowDataPacket, ResultSetHeader } from '~~/server/utils/db'
import { hasWorkItemStartDateColumn } from '~~/server/utils/workItemStartDate'
import { assertProjectActive, assertProjectStructureEditable } from '~~/server/utils/projectLifecycle'

interface ProjectRow extends RowDataPacket {
  id: number
  project_code: string
}

interface CounterRow extends RowDataPacket {
  next_number: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const projectId = Number(getRouterParam(event, 'id'))
  if (!projectId || isNaN(projectId)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  const body = await readBody(event)
  if (!body?.type) {
    throw createError({ statusCode: 400, message: '工作项类型不能为空' })
  }
  if (!body?.title?.trim()) {
    throw createError({ statusCode: 400, message: '标题不能为空' })
  }
  if (!body?.milestoneId) {
    throw createError({ statusCode: 400, message: '里程碑不能为空' })
  }

  // 生命周期门控：
  //   - target 层（立项书 WBS 的一部分）：允许 draft / active
  //   - matter 层（执行层任务）：仅 active（立项后）
  const tierForGate = body.tier || 'matter'
  if (tierForGate === 'target') {
    await assertProjectStructureEditable(projectId)
  } else {
    await assertProjectActive(projectId)
  }

  // PIVR 阶段约束：P 阶段里程碑下禁止添加"需求类"工作目标
  if (tierForGate === 'target' && body.type === 'requirement') {
    const milestoneRow = await queryRow<RowDataPacket & { pivr_stage: string | null }>(
      'SELECT pivr_stage FROM milestones WHERE id = ? AND project_id = ?',
      [Number(body.milestoneId), projectId]
    )
    if (milestoneRow?.pivr_stage === 'P') {
      throw createError({ statusCode: 400, message: 'P 阶段里程碑下不允许创建需求类工作目标' })
    }
  }

  // 获取项目信息
  const project = await queryRow<ProjectRow>(
    'SELECT id, project_code FROM aims_projects WHERE id = ?',
    [projectId]
  )
  if (!project) {
    throw createError({ statusCode: 404, message: '项目不存在' })
  }

  // 自增编号：使用 LAST_INSERT_ID 技巧保证原子性
  await execute(
    'UPDATE project_counters SET counter = LAST_INSERT_ID(counter + 1) WHERE project_id = ?',
    [projectId]
  )
  const counterRow = await queryRow<CounterRow>(
    'SELECT LAST_INSERT_ID() AS next_number'
  )
  if (!counterRow) {
    throw createError({ statusCode: 500, message: '获取工作项编号失败' })
  }

  const itemNumber = counterRow.next_number
  const itemKey = `${project.project_code}-${itemNumber}`

  // 默认状态：target 层 → planning，matter 层 → todo
  const tier = body.tier || 'matter'
  let status = body.status
  if (!status) {
    status = tier === 'target' ? 'planning' : 'todo'
  }
  const supportsStartDate = await hasWorkItemStartDateColumn()

  const reviewLevel = body.reviewLevel !== undefined && body.reviewLevel !== null
    ? Math.max(0, Math.min(4, Math.round(Number(body.reviewLevel))))
    : 1

  const columns = [
    'project_id', 'milestone_id', 'item_number', 'item_key', 'type', 'tier', 'title', 'description',
    ...(supportsStartDate ? ['start_date'] : []),
    'status', 'priority', 'severity', 'weight', 'assignee_uid', 'reporter_uid', 'due_date',
    'estimated_hours', 'parent_id', 'sort_order', 'review_level', 'required', 'template_key'
  ]

  const params = [
    projectId,
    body.milestoneId,
    itemNumber,
    itemKey,
    body.type,
    body.tier || 'matter',
    body.title.trim(),
    body.description || null,
    ...(supportsStartDate ? [body.startDate || null] : []),
    status,
    body.priority || 'P2',
    body.severity || null,
    body.weight || 1,
    body.assigneeUid || null,
    uid,
    body.dueDate || null,
    body.estimatedHours || null,
    body.parentId || null,
    0,
    reviewLevel,
    body.required ? 1 : 0,
    body.templateKey || null
  ]

  const result = await execute<ResultSetHeader>(
    `INSERT INTO work_items
     (${columns.join(', ')})
     VALUES (${columns.map(() => '?').join(', ')})`,
    params
  )

  const workItemId = result.insertId

  // 记录创建日志
  await execute(
    `INSERT INTO work_item_changelog (work_item_id, field_name, old_value, new_value, changed_by)
     VALUES (?, 'created', NULL, ?, ?)`,
    [workItemId, itemKey, uid]
  )

  // 异步发送通知，不阻塞响应返回
  if (body.assigneeUid && body.assigneeUid !== uid) {
    notifyTaskAssigned(workItemId, body.assigneeUid, uid)
  }

  return {
    code: 0,
    data: {
      id: workItemId,
      itemNumber,
      itemKey
    }
  }
})
