import { queryRows } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'
import { verifyApiKey } from '~~/server/utils/api-auth'
import type { H3Event } from 'h3'

interface DomainRow extends RowDataPacket {
  id: number
  domain_code: string
  domain_name: string
  category: string
  parent_code: string | null
  description: string | null
  sort_order: number
  status: number
}

function hasApiCredentials(event: H3Event) {
  const authHeader = getHeader(event, 'authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return true
  }

  const query = getQuery(event)
  return Boolean(query.api_key && query.api_secret)
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const category = query.category as string | undefined

  try {
    if (hasApiCredentials(event)) {
      const keyRecord = await verifyApiKey(event)

      if (keyRecord.company_code) {
        let sql = `
          SELECT
            COALESCE(bd.id, cbd.id) AS id,
            cbd.domain_code,
            cbd.domain_name,
            cbd.alias_name,
            cbd.category,
            bd.parent_code,
            bd.description,
            cbd.sort_order
          FROM company_business_domains cbd
          LEFT JOIN business_domains bd
            ON bd.domain_code = cbd.domain_code
            AND bd.status = 1
          WHERE cbd.company_code = ?
            AND cbd.status = 1
        `
        const params: unknown[] = [keyRecord.company_code]

        if (category) {
          sql += ' AND cbd.category = ?'
          params.push(category)
        }

        sql += ' ORDER BY cbd.domain_code ASC, cbd.sort_order ASC'

        const rows = await queryRows<DomainRow[]>(sql, params)

        return {
          code: 0,
          data: rows.map(row => ({
            id: row.id,
            domainCode: row.domain_code,
            domainName: row.alias_name || row.domain_name,
            category: row.category,
            parentCode: row.parent_code,
            description: row.description,
            sortOrder: row.sort_order
          }))
        }
      }
    }

    let sql = 'SELECT * FROM business_domains WHERE status = 1'
    const params: unknown[] = []

    if (category) {
      sql += ' AND category = ?'
      params.push(category)
    }

    sql += ' ORDER BY domain_code ASC, sort_order ASC, id ASC'

    const rows = await queryRows<DomainRow[]>(sql, params)

    return {
      code: 0,
      data: rows.map(row => ({
        id: row.id,
        domainCode: row.domain_code,
        domainName: row.alias_name || row.domain_name,
        category: row.category,
        parentCode: row.parent_code,
        description: row.description,
        sortOrder: row.sort_order
      }))
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to get business domains:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '获取业务领域字典失败'
    })
  }
})
