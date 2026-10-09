import { queryRows } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

interface RegionRow extends RowDataPacket {
  id: number
  company_code: string
  region_code: string
  region_name: string
  description: string | null
  sort_order: number
  status: number
}

interface DivisionCountRow extends RowDataPacket {
  region_code: string
  division_count: number
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
    const rows = await queryRows<RegionRow[]>(
      `SELECT * FROM company_regions
       WHERE company_code = ? AND status = 1
       ORDER BY sort_order ASC, id ASC`,
      [companyCode]
    )

    // 查询每个区域关联的行政区划数量
    const regionCodes = rows.map(r => r.region_code)
    let divisionCounts = new Map<string, number>()

    if (regionCodes.length > 0) {
      const countRows = await queryRows<DivisionCountRow[]>(
        `SELECT region_code, COUNT(*) AS division_count
         FROM company_region_divisions
         WHERE company_code = ? AND region_code IN (${regionCodes.map(() => '?').join(',')})
         GROUP BY region_code`,
        [companyCode, ...regionCodes]
      )
      divisionCounts = new Map(countRows.map(r => [r.region_code, r.division_count]))
    }

    return {
      code: 0,
      data: rows.map(row => ({
        id: row.id,
        companyCode: row.company_code,
        regionCode: row.region_code,
        regionName: row.region_name,
        description: row.description,
        sortOrder: row.sort_order,
        divisionCount: divisionCounts.get(row.region_code) || 0
      }))
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to get company regions:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '获取区域列表失败'
    })
  }
})
