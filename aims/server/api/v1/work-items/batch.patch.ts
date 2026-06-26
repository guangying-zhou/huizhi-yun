/**
 * 批量更新工作项
 * PATCH /api/v1/work-items/batch
 * Body: { ids: number[], changes: { status?, priority?, assigneeUid?, milestoneId? } }
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { getProjectLifecycleStatus } from '~~/server/utils/projectLifecycle'

interface WorkItemRow extends RowDataPacket {
  id: number
  project_id: number
  tier: string
  type: string
  status: string
  priority: string
  assignee_uid: string | null
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const body = await readBody(event)
  if (!body?.ids?.length || !Array.isArray(body.ids)) {
    throw createError({ statusCode: 400, message: 'ids 不能为空' })
  }
  if (!body.changes || typeof body.changes !== 'object') {
    throw createError({ statusCode: 400, message: 'changes 不能为空' })
  }

  const { ids, changes } = body
  const placeholders = ids.map(() => '?').join(', ')

  // 查询所有目标工作项
  const items = await queryRows<WorkItemRow[]>(
    `SELECT id, project_id, tier, type, status, priority, assignee_uid
     FROM work_items WHERE id IN (${placeholders})`,
    ids
  )

  if (items.length === 0) {
    throw createError({ statusCode: 404, message: '工作项不存在' })
  }

  // 生命周期门控：批量更新一律要求所涉项目都处于 active
  const projectIds = Array.from(new Set(items.map(i => i.project_id)))
  for (const pid of projectIds) {
    const status = await getProjectLifecycleStatus(pid)
    if (status !== 'active') {
      throw createError({
        statusCode: 409,
        message: `项目当前状态（${status}）不允许批量修改工作项`
      })
    }
  }

  // 如果有状态变更，逐个校验
  if (changes.status) {
    for (const item of items) {
      if (item.status === changes.status) continue
      const entityType = item.tier as string
      const valid = await validateTransition(
        item.project_id,
        entityType,
        item.status,
        changes.status
      )
      if (!valid) {
        throw createError({
          statusCode: 400,
          message: `工作项 #${item.id} 不允许从 "${item.status}" 转换到 "${changes.status}"`
        })
      }
    }
  }

  // 构建更新字段
  const fieldMapping: Record<string, string> = {
    status: 'status',
    priority: 'priority',
    assigneeUid: 'assignee_uid',
    milestoneId: 'milestone_id'
  }

  const setClauses: string[] = []
  const updateParams: unknown[] = []

  for (const [bodyKey, sqlCol] of Object.entries(fieldMapping)) {
    if (changes[bodyKey] === undefined) continue
    setClauses.push(`${sqlCol} = ?`)
    updateParams.push(changes[bodyKey])
  }

  if (setClauses.length === 0) {
    return { code: 0, data: { updated: 0 } }
  }

  // 批量更新
  updateParams.push(...ids)
  await execute(
    `UPDATE work_items SET ${setClauses.join(', ')} WHERE id IN (${placeholders})`,
    updateParams
  )

  // 批量记录变更日志
  const dbFieldMap: Record<string, string> = {
    status: 'status',
    priority: 'priority',
    assigneeUid: 'assignee_uid',
    milestoneId: 'milestone_id'
  }

  const changelogValues: unknown[] = []
  const changelogPlaceholders: string[] = []

  for (const item of items) {
    for (const [bodyKey, dbKey] of Object.entries(dbFieldMap)) {
      if (changes[bodyKey] === undefined) continue
      const oldVal = (item as Record<string, unknown>)[dbKey]
      const oldStr = oldVal === null || oldVal === undefined ? null : String(oldVal)
      const newStr = changes[bodyKey] === null ? null : String(changes[bodyKey])
      if (oldStr === newStr) continue

      changelogPlaceholders.push('(?, ?, ?, ?, ?)')
      changelogValues.push(item.id, bodyKey, oldStr, newStr, uid)
    }
  }

  if (changelogPlaceholders.length > 0) {
    await execute(
      `INSERT INTO work_item_changelog (work_item_id, field_name, old_value, new_value, changed_by)
       VALUES ${changelogPlaceholders.join(', ')}`,
      changelogValues
    )
  }

  return { code: 0, data: { updated: items.length } }
})
