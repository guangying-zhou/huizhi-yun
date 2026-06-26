/**
 * 更新工作项
 * PUT /api/v1/work-items/:id
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { hasWorkItemStartDateColumn } from '~~/server/utils/workItemStartDate'
import { getProjectLifecycleStatus } from '~~/server/utils/projectLifecycle'

interface WorkItemRow extends RowDataPacket {
  id: number
  project_id: number
  tier: string
  type: string
  title: string
  description: string | null
  start_date: string | null
  status: string
  priority: string
  severity: string | null
  assignee_uid: string | null
  reporter_uid: string | null
  due_date: string | null
  estimated_hours: number | null
  parent_id: number | null
  sort_order: number
}

// 字段映射：body key → SQL column
const fieldMap: Record<string, string> = {
  title: 'title',
  description: 'description',
  milestoneId: 'milestone_id',
  status: 'status',
  priority: 'priority',
  severity: 'severity',
  weight: 'weight',
  assigneeUid: 'assignee_uid',
  reporterUid: 'reporter_uid',
  dueDate: 'due_date',
  estimatedHours: 'estimated_hours',
  parentId: 'parent_id',
  sortOrder: 'sort_order'
}

// body key → 数据库原始值 key
const dbKeyMap: Record<string, string> = {
  title: 'title',
  description: 'description',
  milestoneId: 'milestone_id',
  status: 'status',
  priority: 'priority',
  severity: 'severity',
  weight: 'weight',
  assigneeUid: 'assignee_uid',
  reporterUid: 'reporter_uid',
  dueDate: 'due_date',
  estimatedHours: 'estimated_hours',
  parentId: 'parent_id',
  sortOrder: 'sort_order'
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

  const item = await queryRow<WorkItemRow>(
    'SELECT * FROM work_items WHERE id = ?',
    [workItemId]
  )
  if (!item) {
    throw createError({ statusCode: 404, message: '工作项不存在' })
  }

  const body = await readBody(event)
  const supportsStartDate = await hasWorkItemStartDateColumn()

  // 生命周期门控：
  //   - target 层 + 不涉及状态流转（或新状态仍是 planning）→ 允许 draft / active
  //   - 其他情况（matter 任一修改，或 target 状态流转到非 planning）→ 仅 active
  const projectLifecycle = await getProjectLifecycleStatus(item.project_id)
  const isStatusTransition = body.status !== undefined && body.status !== item.status
  const isStructureOnlyEdit = item.tier === 'target' && (!isStatusTransition || body.status === 'planning')
  const lifecycleOk = isStructureOnlyEdit
    ? (projectLifecycle === 'draft' || projectLifecycle === 'active')
    : (projectLifecycle === 'active')
  if (!lifecycleOk) {
    const msg = projectLifecycle === 'draft'
      ? '项目尚未立项，仅允许编辑工作目标基本信息，不允许流转状态或修改任务层'
      : projectLifecycle === 'approval_pending'
        ? '项目立项审批中，请等待审批通过'
        : projectLifecycle === 'paused'
          ? '项目已暂停，恢复后可继续操作'
          : projectLifecycle === 'completed'
            ? '项目已完成'
            : '项目已归档'
    throw createError({ statusCode: 409, message: msg })
  }

  // 分配锁：matter 一旦离开 planning 态（已确认分配或开始执行），禁止修改业务字段；
  // 仅允许状态流转（status 字段）与排序（sortOrder）
  if (item.tier === 'matter' && item.status !== 'planning') {
    const lockedFields = ['title', 'description', 'assigneeUid', 'reporterUid', 'estimatedHours', 'startDate', 'dueDate', 'priority']
    const attempted = lockedFields.filter(k => body[k] !== undefined)
    if (attempted.length > 0) {
      throw createError({
        statusCode: 409,
        message: `任务已进入待办/执行态，字段 ${attempted.join(', ')} 已锁定。如需调整请在 breakdown 页撤回分配`
      })
    }
  }

  const effectiveFieldMap = supportsStartDate
    ? { ...fieldMap, startDate: 'start_date' }
    : fieldMap
  const effectiveDbKeyMap = supportsStartDate
    ? { ...dbKeyMap, startDate: 'start_date' }
    : dbKeyMap

  // 状态变更校验
  if (body.status && body.status !== item.status) {
    const entityType = item.tier as string
    const valid = await validateTransition(
      item.project_id,
      entityType,
      item.status,
      body.status
    )
    if (!valid) {
      throw createError({
        statusCode: 400,
        message: `不允许从 "${item.status}" 转换到 "${body.status}"`
      })
    }

    // 反向阻止：target 从"执行中"退回"待办"时，如果仍有子事项处于"执行中"，不允许退回
    if (entityType === 'target' && item.status === 'in_progress' && body.status === 'todo') {
      const activeChildren = await queryRow<RowDataPacket & { cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM work_items
         WHERE parent_id = ? AND status = 'in_progress'`,
        [workItemId]
      )
      if (activeChildren && activeChildren.cnt > 0) {
        throw createError({
          statusCode: 409,
          message: `存在 ${activeChildren.cnt} 个处于"执行中"的子事项，无法退回到"待办"`
        })
      }
    }
  }

  const fields: string[] = []
  const params: unknown[] = []
  const changelogEntries: { fieldName: string, oldValue: string | null, newValue: string | null }[] = []

  for (const [bodyKey, sqlCol] of Object.entries(effectiveFieldMap)) {
    if (body[bodyKey] === undefined) continue

    const newVal = body[bodyKey]
    const dbKey = effectiveDbKeyMap[bodyKey]
    if (!dbKey) continue
    const oldVal = (item as Record<string, unknown>)[dbKey]

    // 跳过值未变化的字段
    const oldStr = oldVal === null || oldVal === undefined ? null : String(oldVal)
    const newStr = newVal === null || newVal === undefined ? null : String(newVal)
    if (oldStr === newStr) continue

    fields.push(`${sqlCol} = ?`)
    params.push(newVal === undefined ? null : newVal)

    changelogEntries.push({
      fieldName: bodyKey,
      oldValue: oldStr,
      newValue: newStr
    })
  }

  if (fields.length === 0) {
    return { code: 0, data: null }
  }

  params.push(workItemId)
  await execute(
    `UPDATE work_items SET ${fields.join(', ')} WHERE id = ?`,
    params
  )

  // 记录变更日志
  if (changelogEntries.length > 0) {
    const valuePlaceholders = changelogEntries.map(() => '(?, ?, ?, ?, ?)').join(', ')
    const changelogParams: unknown[] = []
    for (const entry of changelogEntries) {
      changelogParams.push(workItemId, entry.fieldName, entry.oldValue, entry.newValue, uid)
    }
    await execute(
      `INSERT INTO work_item_changelog (work_item_id, field_name, old_value, new_value, changed_by)
       VALUES ${valuePlaceholders}`,
      changelogParams
    )
  }

  // 异步发送通知，不阻塞响应返回
  for (const entry of changelogEntries) {
    if (entry.fieldName === 'status') {
      notifyStatusChanged(workItemId, entry.oldValue!, entry.newValue!, uid)
    }
    if (entry.fieldName === 'assigneeUid' && entry.newValue && entry.newValue !== uid) {
      notifyTaskAssigned(workItemId, entry.newValue, uid)
    }
  }

  // 前向级联：matter 从"待办"进入"执行中"时，若父 target 仍在"待办"，自动同步为"执行中"
  if (
    item.tier === 'matter'
    && item.parent_id
    && body.status === 'in_progress'
    && item.status === 'todo'
  ) {
    const parent = await queryRow<WorkItemRow>(
      'SELECT * FROM work_items WHERE id = ?',
      [item.parent_id]
    )
    if (parent && parent.tier === 'target' && parent.status === 'todo') {
      const parentValid = await validateTransition(
        parent.project_id,
        'target',
        parent.status,
        'in_progress'
      )
      if (parentValid) {
        await execute(
          'UPDATE work_items SET status = ? WHERE id = ?',
          ['in_progress', parent.id]
        )
        await execute(
          `INSERT INTO work_item_changelog (work_item_id, field_name, old_value, new_value, changed_by)
           VALUES (?, 'status', ?, 'in_progress', ?)`,
          [parent.id, parent.status, uid]
        )
        notifyStatusChanged(parent.id, parent.status, 'in_progress', uid)
      }
    }
  }

  return { code: 0, data: null }
})
