import { queryRows, execute } from '~~/server/utils/db'
import { logOperationFromEvent } from '~~/server/utils/log'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'

interface UpdateRegionBody {
  regionName?: string
  description?: string
  sortOrder?: number
  status?: number
}

interface ExistRow extends RowDataPacket {
  id: number
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

  const body = await readBody<UpdateRegionBody>(event)

  try {
    const existing = await queryRows<ExistRow[]>(
      'SELECT id FROM company_regions WHERE company_code = ? AND region_code = ?',
      [companyCode, regionCode]
    )

    if (existing.length === 0) {
      throw createError({
        statusCode: 404,
        message: '区域不存在'
      })
    }

    const sets: string[] = []
    const params: unknown[] = []

    if (body.regionName !== undefined) {
      sets.push('region_name = ?')
      params.push(body.regionName)
    }
    if (body.description !== undefined) {
      sets.push('description = ?')
      params.push(body.description)
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

    params.push(companyCode, regionCode)
    await execute<ResultSetHeader>(
      `UPDATE company_regions SET ${sets.join(', ')} WHERE company_code = ? AND region_code = ?`,
      params
    )

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'company_region.update',
      targetType: 'company_region',
      targetId: `${companyCode}:${regionCode}`,
      detail: { ...body }
    })

    return {
      code: 0,
      message: '更新成功'
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to update company region:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '更新区域失败'
    })
  }
})
