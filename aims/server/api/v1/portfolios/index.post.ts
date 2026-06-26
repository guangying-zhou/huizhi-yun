/**
 * 创建项目集
 * POST /api/v1/portfolios
 */
import type { ResultSetHeader } from '~~/server/utils/db'
import { requireRole } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }
  await requireRole(event, 'aims:admin', '仅 AIMS 管理员可以创建项目集')

  const body = await readBody(event)
  if (!body?.code?.trim()) {
    throw createError({ statusCode: 400, message: '项目集编码不能为空' })
  }
  if (!body?.name?.trim()) {
    throw createError({ statusCode: 400, message: '项目集名称不能为空' })
  }
  const displayOrder = Number(body.displayOrder ?? 0)

  const result = await execute<ResultSetHeader>(
    `INSERT INTO project_portfolios (code, name, description, domain_code, owner_uid, dept_code, git_group, is_product_line, display_order, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      body.code.trim().toUpperCase(),
      body.name.trim(),
      body.description || null,
      body.domainCode || null,
      body.ownerUid || null,
      body.deptCode || null,
      body.gitGroup || null,
      body.isProductLine ? 1 : 0,
      Number.isFinite(displayOrder) ? Math.trunc(displayOrder) : 0,
      uid
    ]
  )

  return {
    code: 0,
    data: { id: result.insertId, code: body.code.trim().toUpperCase() }
  }
})
