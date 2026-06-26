/**
 * 创建项目
 * POST /api/v1/projects
 */
import type { ResultSetHeader, RowDataPacket } from '~~/server/utils/db'
import { requirePermission } from '~~/server/utils/checkPermission'
import { useDbPool } from '~~/server/utils/db'
import { instantiateProjectFromTemplate, resolveProjectTemplateVersion } from '~~/server/utils/projectTemplates'

interface DuplicateCheckRow extends RowDataPacket {
  cnt: number
}

interface PortfolioRow extends RowDataPacket {
  id: number
  is_product_line: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }
  await requirePermission(event, 'projects', 'admin', '需要 AIMS 项目管理权限才可以创建项目')

  const body = await readBody(event)
  if (!body) {
    throw createError({ statusCode: 400, message: '请求体不能为空' })
  }

  const {
    projectCode,
    name,
    shortName,
    internalCode,
    description,
    category,
    methodology,
    portfolioId,
    domainCode,
    deptCode,
    leaderUid,
    startDate,
    endDate,
    oppId,
    contractId,
    customerCode,
    customerName,
    contractCode,
    moduleConfig,
    templateVersionId,
    excludedWorkItemKeys
  } = body

  // 必填字段校验
  if (!projectCode || !name || !shortName) {
    throw createError({ statusCode: 400, message: '项目编码、名称和简称为必填项' })
  }

  // 校验 projectCode 唯一性（排除已归档项目）
  const codeDupCheck = await queryRow<DuplicateCheckRow>(
    'SELECT COUNT(*) AS cnt FROM aims_projects WHERE project_code = ? AND lifecycle_status != \'archived\'',
    [projectCode]
  )
  if (codeDupCheck && codeDupCheck.cnt > 0) {
    throw createError({ statusCode: 400, message: `项目编码 "${projectCode}" 已被使用` })
  }

  let normalizedCategory = category || 'product_dev'
  const effectivePortfolioId = portfolioId ? Number(portfolioId) : null
  if (effectivePortfolioId) {
    const portfolio = await queryRow<PortfolioRow>(
      'SELECT id, is_product_line FROM project_portfolios WHERE id = ?',
      [effectivePortfolioId]
    )
    if (!portfolio) {
      throw createError({ statusCode: 400, message: '所选项目集不存在' })
    }
    if (portfolio.is_product_line) {
      normalizedCategory = 'product_dev'
    }
  }

  const resolvedTemplate = await resolveProjectTemplateVersion(normalizedCategory, templateVersionId ? Number(templateVersionId) : null)
  const connection = await useDbPool().getConnection()
  let projectId = 0

  try {
    await connection.beginTransaction()

    const insertSql = `
      INSERT INTO aims_projects (
        project_code, name, short_name, internal_code, description, category, methodology,
        portfolio_id, domain_code, dept_code, leader_uid,
        start_date, end_date, opp_id, contract_id, customer_code, customer_name, contract_code,
        module_config, template_set_id, template_version_id, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    const [result] = await connection.execute<ResultSetHeader>(insertSql, [
      projectCode,
      name,
      shortName,
      internalCode || null,
      description || null,
      normalizedCategory,
      methodology || 'PIVR',
      effectivePortfolioId,
      domainCode || null,
      deptCode || null,
      leaderUid || null,
      startDate || null,
      endDate || null,
      oppId ? Number(oppId) : null,
      contractId ? Number(contractId) : null,
      customerCode || null,
      customerName || null,
      contractCode || null,
      moduleConfig ? JSON.stringify(moduleConfig) : null,
      resolvedTemplate.templateSetId,
      resolvedTemplate.templateVersionId,
      uid
    ])

    projectId = result.insertId

    await connection.execute(
      'INSERT INTO project_counters (project_id, counter) VALUES (?, 0)',
      [projectId]
    )

    await connection.execute(
      'INSERT INTO aims_project_members (project_id, uid, role) VALUES (?, ?, ?)',
      [projectId, uid, 'manager']
    )

    await instantiateProjectFromTemplate({
      connection,
      projectId,
      projectCode,
      templateVersionId: resolvedTemplate.templateVersionId,
      createdBy: uid,
      excludedWorkItemKeys: Array.isArray(excludedWorkItemKeys) ? new Set(excludedWorkItemKeys as string[]) : undefined
    })

    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  return {
    code: 0,
    data: { id: projectId }
  }
})
