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
  const companyCode = getRouterParam(event, 'companyCode')

  if (!companyCode) {
    throw createError({
      statusCode: 400,
      message: '公司编码不能为空'
    })
  }

  try {
    const rows = await queryRows<CompanyRow[]>(
      'SELECT * FROM companies WHERE company_code = ?',
      [companyCode]
    )

    if (rows.length === 0) {
      throw createError({
        statusCode: 404,
        message: '公司不存在'
      })
    }

    const row = rows[0]!
    return {
      code: 0,
      data: {
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
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to get company:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '获取公司信息失败'
    })
  }
})
