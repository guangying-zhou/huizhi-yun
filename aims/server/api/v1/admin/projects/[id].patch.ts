/**
 * 系统管理员修改项目基础信息与生命周期阶段
 * PATCH /api/v1/admin/projects/:id
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { initializeProjectMilestonesOnActivation } from '~~/server/utils/projectMilestones'
import { requireGlobalProjectAdmin } from '~~/server/utils/projectPermission'

const allowedCategory = new Set(['product_dev', 'custom_dev', 'delivery', 'maintenance', 'sales', 'presales', 'improvement', 'compliance'])
const allowedMethodology = new Set(['PIVR', 'agile', 'waterfall', 'kanban', 'hybrid'])
const allowedLifecycleStatus = new Set(['draft', 'approval_pending', 'active', 'paused', 'completed', 'archived'])

interface ProjectRow extends RowDataPacket {
  id: number
  lifecycle_status: string
}

interface PortfolioRow extends RowDataPacket {
  id: number
  is_product_line: number
}

function normalizeString(value: unknown) {
  if (value == null) return null
  const text = String(value).trim()
  return text || null
}

export default defineEventHandler(async (event) => {
  await requireGlobalProjectAdmin(event)

  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  const project = await queryRow<ProjectRow>(
    'SELECT id, lifecycle_status FROM aims_projects WHERE id = ?',
    [id]
  )
  if (!project) {
    throw createError({ statusCode: 404, message: '项目不存在' })
  }

  const body = await readBody(event)
  if (!body) {
    throw createError({ statusCode: 400, message: '请求体不能为空' })
  }

  const normalizedBody = { ...body }
  if ('category' in normalizedBody && !allowedCategory.has(normalizedBody.category)) {
    throw createError({ statusCode: 400, message: '无效的项目分类' })
  }
  if ('methodology' in normalizedBody && !allowedMethodology.has(normalizedBody.methodology)) {
    throw createError({ statusCode: 400, message: '无效的管理方法论' })
  }
  if ('lifecycleStatus' in normalizedBody && !allowedLifecycleStatus.has(normalizedBody.lifecycleStatus)) {
    throw createError({ statusCode: 400, message: '无效的生命周期阶段' })
  }

  if ('portfolioId' in normalizedBody && normalizedBody.portfolioId != null) {
    const portfolio = await queryRow<PortfolioRow>(
      'SELECT id, is_product_line FROM project_portfolios WHERE id = ?',
      [normalizedBody.portfolioId]
    )
    if (!portfolio) {
      throw createError({ statusCode: 400, message: '所选项目集不存在' })
    }
    if (portfolio.is_product_line) {
      normalizedBody.category = 'product_dev'
    }
  }

  const allowedFields: Record<string, string> = {
    name: 'name',
    shortName: 'short_name',
    internalCode: 'internal_code',
    description: 'description',
    category: 'category',
    methodology: 'methodology',
    lifecycleStatus: 'lifecycle_status',
    portfolioId: 'portfolio_id',
    domainCode: 'domain_code',
    deptCode: 'dept_code',
    leaderUid: 'leader_uid',
    startDate: 'start_date',
    endDate: 'end_date',
    customerName: 'customer_name',
    contractCode: 'contract_code'
  }

  const requiredTextFields = new Set(['name', 'shortName'])
  const setClauses: string[] = []
  const params: unknown[] = []

  for (const [camelKey, dbColumn] of Object.entries(allowedFields)) {
    if (!(camelKey in normalizedBody)) continue

    const rawValue = normalizedBody[camelKey]
    const value = typeof rawValue === 'string' ? normalizeString(rawValue) : rawValue

    if (requiredTextFields.has(camelKey) && !value) {
      throw createError({ statusCode: 400, message: camelKey === 'name' ? '项目名称不能为空' : '项目简称不能为空' })
    }

    setClauses.push(`${dbColumn} = ?`)
    params.push(value ?? null)
  }

  if (setClauses.length === 0) {
    throw createError({ statusCode: 400, message: '没有需要更新的字段' })
  }

  await execute(
    `UPDATE aims_projects SET ${setClauses.join(', ')} WHERE id = ?`,
    [...params, id]
  )

  const shouldInitializeMilestones = normalizedBody.lifecycleStatus === 'active'
    && project.lifecycle_status !== 'active'
    && ['draft', 'approval_pending'].includes(project.lifecycle_status)

  if (shouldInitializeMilestones) {
    await initializeProjectMilestonesOnActivation(id)
  }

  return {
    code: 0,
    data: null
  }
})
