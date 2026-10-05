import { queryRows } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

interface CompanyRow extends RowDataPacket {
  id: number
  company_code: string
  company_name: string
  short_name: string | null
  logo: string | null
  industry: string | null
  scale: string | null
  province: string | null
  city: string | null
  address: string | null
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  website: string | null
  description: string | null
  status: number
  created_at: string
  updated_at: string
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const search = (query.search as string) || ''
  const status = query.status as string | undefined

  try {
    let sql = 'SELECT * FROM companies WHERE 1=1'
    const params: unknown[] = []

    if (search) {
      sql += ' AND (company_name LIKE ? OR short_name LIKE ? OR company_code LIKE ?)'
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }

    if (status !== undefined && status !== '') {
      sql += ' AND status = ?'
      params.push(Number(status))
    }

    sql += ' ORDER BY id ASC'

    const rows = await queryRows<CompanyRow[]>(sql, params)

    return {
      code: 0,
      data: rows.map(row => ({
        id: row.id,
        companyCode: row.company_code,
        companyName: row.company_name,
        shortName: row.short_name,
        logo: row.logo,
        industry: row.industry,
        scale: row.scale,
        province: row.province,
        city: row.city,
        address: row.address,
        contactName: row.contact_name,
        contactPhone: row.contact_phone,
        contactEmail: row.contact_email,
        website: row.website,
        description: row.description,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to get companies:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '获取公司列表失败'
    })
  }
})
