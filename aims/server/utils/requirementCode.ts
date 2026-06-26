import type { PoolConnection, RowDataPacket } from '~~/server/utils/db'

interface RequirementCounterRow extends RowDataPacket {
  max_number: number
}

/**
 * Generate a globally unique, project-prefixed requirement code.
 *
 * `req_number` remains project-local for sorting and stable numeric references,
 * while `req_code` includes the project code because the database enforces a
 * global unique key on requirement_items.req_code.
 */
export async function nextRequirementCode(
  conn: PoolConnection,
  projectId: number
): Promise<{ reqNumber: number, reqCode: string }> {
  const [projectRows] = await conn.query<(RowDataPacket & { project_code: string })[]>(
    'SELECT project_code FROM aims_projects WHERE id = ?',
    [projectId]
  )
  const projectCode = projectRows[0]?.project_code?.trim()
  if (!projectCode) {
    throw createError({ statusCode: 500, message: '项目编码不存在，无法生成需求编号' })
  }

  // 采用非锁定读取，避免与长事务互相等待；
  // 并发冲突由 requirement_items.uk_project_req_number + 上层重试兜底。
  const [counterRows] = await conn.query<RequirementCounterRow[]>(
    `SELECT COALESCE(MAX(req_number), 0) AS max_number
     FROM requirement_items
     WHERE project_id = ?
     `,
    [projectId]
  )
  const reqNumber = (counterRows[0]?.max_number || 0) + 1

  return {
    reqNumber,
    reqCode: `${projectCode}-REQ-${String(reqNumber).padStart(3, '0')}`
  }
}
