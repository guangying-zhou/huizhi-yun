/**
 * 更新项目集
 * PUT /api/v1/portfolios/:id
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { requireRole } from '~~/server/utils/checkPermission'

interface PortfolioRow extends RowDataPacket {
  id: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }
  await requireRole(event, 'aims:admin', '仅 AIMS 管理员可以修改项目集')

  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的项目集ID' })
  }

  const portfolio = await queryRow<PortfolioRow>(
    'SELECT id FROM project_portfolios WHERE id = ?',
    [id]
  )
  if (!portfolio) {
    throw createError({ statusCode: 404, message: '项目集不存在' })
  }

  const body = await readBody(event)

  const fieldMap: Record<string, string> = {
    code: 'code',
    name: 'name',
    description: 'description',
    domainCode: 'domain_code',
    ownerUid: 'owner_uid',
    deptCode: 'dept_code',
    gitGroup: 'git_group',
    isProductLine: 'is_product_line',
    status: 'status'
  }

  const fields: string[] = []
  const params: unknown[] = []

  for (const [bodyKey, dbCol] of Object.entries(fieldMap)) {
    if (body[bodyKey] !== undefined) {
      fields.push(`${dbCol} = ?`)
      if (bodyKey === 'isProductLine') {
        params.push(body[bodyKey] ? 1 : 0)
      } else {
        params.push(body[bodyKey] ?? null)
      }
    }
  }

  if (fields.length === 0) {
    throw createError({ statusCode: 400, message: '没有需要更新的字段' })
  }

  params.push(id)
  await execute(
    `UPDATE project_portfolios SET ${fields.join(', ')} WHERE id = ?`,
    params
  )

  return { code: 0, data: null }
})
