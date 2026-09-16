import { queryRows, getConnection } from '~~/server/utils/db'
import { logOperationFromEvent } from '~~/server/utils/log'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'

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

    // 事务删除区域及其映射
    const conn = await getConnection()
    try {
      await conn.beginTransaction()
      await conn.execute<ResultSetHeader>(
        'DELETE FROM company_region_divisions WHERE company_code = ? AND region_code = ?',
        [companyCode, regionCode]
      )
      await conn.execute<ResultSetHeader>(
        'DELETE FROM company_regions WHERE company_code = ? AND region_code = ?',
        [companyCode, regionCode]
      )
      await conn.commit()
    } catch (e) {
      await conn.rollback()
      throw e
    } finally {
      conn.release()
    }

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'company_region.delete',
      targetType: 'company_region',
      targetId: `${companyCode}:${regionCode}`
    })

    return {
      code: 0,
      message: '删除成功'
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to delete company region:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '删除区域失败'
    })
  }
})
