import { queryRows, execute } from '~~/server/utils/db'
import { logOperationFromEvent } from '~~/server/utils/log'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'

interface UpdateDomainBody {
  aliasName?: string | null
  sortOrder?: number
  status?: number
}

interface ExistRow extends RowDataPacket {
  id: number
}

export default defineEventHandler(async (event) => {
  const companyCode = getRouterParam(event, 'companyCode')
  const domainCode = getRouterParam(event, 'domainCode')

  if (!companyCode || !domainCode) {
    throw createError({
      statusCode: 400,
      message: '公司编码和领域编码不能为空'
    })
  }

  const body = await readBody<UpdateDomainBody>(event)

  try {
    const existing = await queryRows<ExistRow[]>(
      'SELECT id FROM company_business_domains WHERE company_code = ? AND domain_code = ?',
      [companyCode, domainCode]
    )

    if (existing.length === 0) {
      throw createError({
        statusCode: 404,
        message: '该领域不存在'
      })
    }

    const sets: string[] = []
    const params: unknown[] = []

    if (body.aliasName !== undefined) {
      sets.push('alias_name = ?')
      params.push(body.aliasName)
    }
    if (body.sortOrder !== undefined) {
      sets.push('sort_order = ?')
      params.push(body.sortOrder)
    }
    if (body.status !== undefined) {
      sets.push('status = ?')
      params.push(body.status)
    }

    if (sets.length === 0) {
      return { code: 0, message: '无需更新' }
    }

    params.push(companyCode, domainCode)
    await execute<ResultSetHeader>(
      `UPDATE company_business_domains SET ${sets.join(', ')} WHERE company_code = ? AND domain_code = ?`,
      params
    )

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'company_domain.update',
      targetType: 'company_business_domain',
      targetId: `${companyCode}:${domainCode}`,
      detail: { ...body }
    })

    return {
      code: 0,
      message: '更新成功'
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to update company business domain:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '更新业务领域失败'
    })
  }
})
