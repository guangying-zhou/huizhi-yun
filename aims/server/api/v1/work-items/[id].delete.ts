/**
 * 删除工作项
 * DELETE /api/v1/work-items/:id
 */
import type { PoolConnection, RowDataPacket } from '~~/server/utils/db'
import { assertProjectActive, assertProjectStructureEditable } from '~~/server/utils/projectLifecycle'

interface WorkItemRow extends RowDataPacket {
  id: number
  item_key: string
  required: number
  tier: 'target' | 'matter'
  project_id: number
}

interface IdRow extends RowDataPacket {
  id: number
}

async function collectDescendantWorkItemIds(connection: PoolConnection, rootId: number): Promise<number[]> {
  const descendants: number[] = []
  let frontier: number[] = [rootId]

  while (frontier.length > 0) {
    const placeholders = frontier.map(() => '?').join(',')
    const [rows] = await connection.query<IdRow[]>(
      `SELECT id FROM work_items WHERE parent_id IN (${placeholders})`,
      frontier
    )
    const next = rows.map(row => Number(row.id)).filter(id => Number.isFinite(id) && id > 0)
    if (next.length === 0) {
      break
    }
    descendants.push(...next)
    frontier = next
  }

  return descendants
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
    'SELECT id, item_key, required, tier, project_id FROM work_items WHERE id = ?',
    [workItemId]
  )
  if (!item) {
    throw createError({ statusCode: 404, message: '工作项不存在' })
  }
  if (item.required) {
    throw createError({ statusCode: 400, message: '模板必选工作项不允许删除' })
  }

  // 生命周期门控：target 层允许 draft / active；matter 层仅 active
  if (item.tier === 'target') {
    await assertProjectStructureEditable(item.project_id)
  } else {
    await assertProjectActive(item.project_id)
  }

  const connection = await useDbPool().getConnection()
  try {
    await connection.beginTransaction()

    if (item.tier === 'target') {
      const descendantIds = await collectDescendantWorkItemIds(connection, workItemId)
      if (descendantIds.length > 0) {
        const placeholders = descendantIds.map(() => '?').join(',')
        await connection.execute(`DELETE FROM work_items WHERE id IN (${placeholders})`, descendantIds)
      }
    }

    await connection.execute('DELETE FROM work_items WHERE id = ?', [workItemId])
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  return { code: 0, data: null }
})
