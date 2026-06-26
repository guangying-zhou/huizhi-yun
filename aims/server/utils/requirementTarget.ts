import type { PoolConnection, RowDataPacket } from '~~/server/utils/db'
import { queryRow } from '~~/server/utils/db'

/**
 * 查询项目的"需求基线" target 工作项 id。
 *
 * 约定：项目内创建时间最早的 requirement target 视为基线 target。
 * 优先取 template_key='requirement_baseline' 的预置项；若模板未预置，回退到最早创建的
 * requirement target（兼容老项目或非研发模板）。
 * 若项目没有任何 requirement target，返回 null。
 */
export async function getRequirementBaselineWorkItemId(
  projectId: number,
  connection?: PoolConnection
): Promise<number | null> {
  // 按 template_key 优先 + created_at 次之 排序，保证 template_key='requirement_baseline' 总排首位
  const sql = `SELECT id FROM work_items
               WHERE project_id = ?
                 AND tier = 'target'
                 AND type = 'requirement'
               ORDER BY (template_key = 'requirement_baseline') DESC,
                        created_at ASC,
                        id ASC
               LIMIT 1`

  if (connection) {
    const [rows] = await connection.query<(RowDataPacket & { id: number })[]>(sql, [projectId])
    return rows[0]?.id ?? null
  }
  const row = await queryRow<RowDataPacket & { id: number }>(sql, [projectId])
  return row?.id ?? null
}
