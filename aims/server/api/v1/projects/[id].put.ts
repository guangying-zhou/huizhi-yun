/**
 * 更新项目
 * PUT /api/v1/projects/:id
 * 仅 manager 角色可更新
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { initializeProjectMilestonesOnActivation } from '~~/server/utils/projectMilestones'
import { requireProjectManager } from '~~/server/utils/projectPermission'

interface ProjectExistsRow extends RowDataPacket {
  id: number
  lifecycle_status: string
}

interface PortfolioRow extends RowDataPacket {
  id: number
  is_product_line: number
}

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  // 检查项目是否存在
  const project = await queryRow<ProjectExistsRow>(
    'SELECT id, lifecycle_status FROM aims_projects WHERE id = ?',
    [id]
  )
  if (!project) {
    throw createError({ statusCode: 404, message: '项目不存在' })
  }

  await requireProjectManager(event, id, '仅项目经理可以修改项目信息')

  const body = await readBody(event)
  if (!body) {
    throw createError({ statusCode: 400, message: '请求体不能为空' })
  }

  const normalizedBody = { ...body }
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

  // 构建动态更新字段
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
    oppId: 'opp_id',
    contractId: 'contract_id',
    customerCode: 'customer_code',
    customerName: 'customer_name',
    contractCode: 'contract_code',
    moduleConfig: 'module_config',
    boardConfig: 'board_config',
    workflowConfig: 'workflow_config',
    notificationConfig: 'notification_config'
  }

  const setClauses: string[] = []
  const params: unknown[] = []

  for (const [camelKey, dbColumn] of Object.entries(allowedFields)) {
    if (camelKey in normalizedBody) {
      setClauses.push(`${dbColumn} = ?`)
      const value = normalizedBody[camelKey]
      // JSON 字段需要序列化
      if (['moduleConfig', 'boardConfig', 'workflowConfig', 'notificationConfig'].includes(camelKey)) {
        params.push(value != null ? JSON.stringify(value) : null)
      } else {
        params.push(value ?? null)
      }
    }
  }

  if (setClauses.length === 0) {
    throw createError({ statusCode: 400, message: '没有需要更新的字段' })
  }

  params.push(id)
  const updateSql = `UPDATE aims_projects SET ${setClauses.join(', ')} WHERE id = ?`
  await execute(updateSql, params)

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
