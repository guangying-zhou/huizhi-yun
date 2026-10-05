import { queryRows } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

interface CompanyDomainRow extends RowDataPacket {
  id: number
  company_code: string
  domain_code: string
  domain_name: string
  category: string
  alias_name: string | null
  source: string
  sort_order: number
  status: number
}

export default defineEventHandler(async (event) => {
  const companyCode = getRouterParam(event, 'companyCode')

  if (!companyCode) {
    throw createError({
      statusCode: 400,
      message: '公司编码不能为空'
    })
  }

  try {
    const rows = await queryRows<CompanyDomainRow[]>(
      `SELECT * FROM company_business_domains
       WHERE company_code = ? AND status = 1
       ORDER BY domain_code ASC, sort_order ASC`,
      [companyCode]
    )

    return {
      code: 0,
      data: rows.map(row => ({
        id: row.id,
        companyCode: row.company_code,
        domainCode: row.domain_code,
        domainName: row.domain_name,
        category: row.category,
        aliasName: row.alias_name,
        displayName: row.alias_name || row.domain_name,
        source: row.source,
        sortOrder: row.sort_order
      }))
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to get company business domains:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '获取公司业务领域失败'
    })
  }
})
