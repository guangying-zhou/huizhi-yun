import { queryRows, getConnection } from '~~/server/utils/db'
import { logOperationFromEvent } from '~~/server/utils/log'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'

interface CreateRegionBody {
  regionCode: string
  regionName: string
  description?: string
  sortOrder?: number
  divisions?: {
    divisionCode: string
    includeChildren?: boolean
  }[]
}

interface TemplateRow extends RowDataPacket {
  region_code: string
  region_name: string
  division_code: string | null
  include_children: number
  sort_order: number
}

export default defineEventHandler(async (event) => {
  const companyCode = getRouterParam(event, 'companyCode')

  if (!companyCode) {
    throw createError({
      statusCode: 400,
      message: '公司编码不能为空'
    })
  }

  const query = getQuery(event)
  const fromTemplate = query.fromTemplate as string | undefined

  // 从模板初始化
  if (fromTemplate) {
    try {
      const templates = await queryRows<TemplateRow[]>(
        'SELECT region_code, region_name, division_code, include_children, sort_order FROM region_templates WHERE template_code = ?',
        [fromTemplate]
      )

      if (templates.length === 0) {
        throw createError({
          statusCode: 404,
          message: '模板不存在'
        })
      }

      // 提取不重复的区域定义（division_code 为 NULL 的行）
      const regionDefs = templates.filter(t => t.division_code === null)

      const conn = await getConnection()
      try {
        await conn.beginTransaction()
        for (const r of regionDefs) {
          await conn.execute<ResultSetHeader>(
            `INSERT IGNORE INTO company_regions (company_code, region_code, region_name, sort_order)
             VALUES (?, ?, ?, ?)`,
            [companyCode, r.region_code, r.region_name, r.sort_order]
          )
        }

        // 插入区域-行政区划映射
        const divisionMappings = templates.filter(t => t.division_code !== null)
        for (const d of divisionMappings) {
          await conn.execute<ResultSetHeader>(
            `INSERT IGNORE INTO company_region_divisions (company_code, region_code, division_code, include_children)
             VALUES (?, ?, ?, ?)`,
            [companyCode, d.region_code, d.division_code, d.include_children]
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
        action: 'company_region.init_from_template',
        targetType: 'company_region',
        targetId: companyCode,
        detail: { template: fromTemplate, regionCount: regionDefs.length }
      })

      return {
        code: 0,
        message: `从模板初始化了 ${regionDefs.length} 个区域`
      }
    } catch (err: unknown) {
      const error = err as { statusCode?: number, message?: string }
      if (error.statusCode) throw error
      console.error('Failed to init regions from template:', error)
      throw createError({
        statusCode: 500,
        message: error.message || '从模板初始化区域失败'
      })
    }
  }

  // 手动创建单个区域
  const body = await readBody<CreateRegionBody>(event)

  if (!body.regionCode || !body.regionName) {
    throw createError({
      statusCode: 400,
      message: '区域编码和名称不能为空'
    })
  }

  try {
    const conn = await getConnection()
    try {
      await conn.beginTransaction()

      await conn.execute<ResultSetHeader>(
        `INSERT INTO company_regions (company_code, region_code, region_name, description, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [companyCode, body.regionCode, body.regionName, body.description || null, body.sortOrder ?? 0]
      )

      if (body.divisions && body.divisions.length > 0) {
        for (const d of body.divisions) {
          await conn.execute<ResultSetHeader>(
            `INSERT INTO company_region_divisions (company_code, region_code, division_code, include_children)
             VALUES (?, ?, ?, ?)`,
            [companyCode, body.regionCode, d.divisionCode, d.includeChildren !== false ? 1 : 0]
          )
        }
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
      action: 'company_region.create',
      targetType: 'company_region',
      targetId: `${companyCode}:${body.regionCode}`,
      detail: {
        regionName: body.regionName,
        divisionCount: body.divisions?.length || 0
      }
    })

    return {
      code: 0,
      message: '创建成功'
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string, code?: string }
    if (error.statusCode) throw error
    console.error('Failed to create company region:', error)

    if (error.code === 'ER_DUP_ENTRY') {
      throw createError({
        statusCode: 400,
        message: '区域编码已存在'
      })
    }

    throw createError({
      statusCode: 500,
      message: error.message || '创建区域失败'
    })
  }
})
