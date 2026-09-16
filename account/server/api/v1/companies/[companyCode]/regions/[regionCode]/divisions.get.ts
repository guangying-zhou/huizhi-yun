import { queryRows } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

interface DivisionMappingRow extends RowDataPacket {
  id: number
  division_code: string
  include_children: number
}

export default defineEventHandler(async (event) => {
  const companyCode = getRouterParam(event, 'companyCode')
  const regionCode = getRouterParam(event, 'regionCode')

  if (!companyCode || !regionCode) {
    throw createError({
      statusCode: 400,
      message: '公司编码和区域编码不能为空'
    })
  }

  try {
    const rows = await queryRows<DivisionMappingRow[]>(
      `SELECT id, division_code, include_children
       FROM company_region_divisions
       WHERE company_code = ? AND region_code = ?
       ORDER BY division_code ASC`,
      [companyCode, regionCode]
    )

    return {
      code: 0,
      data: rows.map(row => ({
        id: row.id,
        divisionCode: row.division_code,
        includeChildren: Boolean(row.include_children)
      }))
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to get region divisions:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '获取区域行政区划失败'
    })
  }
})
