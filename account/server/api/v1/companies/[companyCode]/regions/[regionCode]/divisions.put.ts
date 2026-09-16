import { queryRows, getConnection } from '~~/server/utils/db'
import { logOperationFromEvent } from '~~/server/utils/log'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'

interface SetDivisionsBody {
  divisions: {
    divisionCode: string
    includeChildren?: boolean
  }[]
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

  const body = await readBody<SetDivisionsBody>(event)

  if (!body.divisions || !Array.isArray(body.divisions)) {
    throw createError({
      statusCode: 400,
      message: 'divisions 必须是数组'
    })
  }

  try {
    // 验证区域存在
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

    // 全量替换：先删后插
    const conn = await getConnection()
    try {
      await conn.beginTransaction()

      await conn.execute<ResultSetHeader>(
        'DELETE FROM company_region_divisions WHERE company_code = ? AND region_code = ?',
        [companyCode, regionCode]
      )

      for (const d of body.divisions) {
        if (!d.divisionCode) continue
        await conn.execute<ResultSetHeader>(
          `INSERT INTO company_region_divisions (company_code, region_code, division_code, include_children)
           VALUES (?, ?, ?, ?)`,
          [companyCode, regionCode, d.divisionCode, d.includeChildren !== false ? 1 : 0]
        )
      }

      await conn.commit()
    } catch (e) {
      await conn.rollback()
      throw e
    } finally {
      conn.release()
    }

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'company_region.set_divisions',
      targetType: 'company_region',
      targetId: `${companyCode}:${regionCode}`,
      detail: { divisionCount: body.divisions.length }
    })

    return {
      code: 0,
      message: `已设置 ${body.divisions.length} 个行政区划`
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to set region divisions:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '设置区域行政区划失败'
    })
  }
})
