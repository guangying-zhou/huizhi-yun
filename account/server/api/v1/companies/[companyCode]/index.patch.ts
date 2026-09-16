import { queryRows, execute } from '~~/server/utils/db'
import { logOperationFromEvent } from '~~/server/utils/log'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'

interface UpdateCompanyBody {
  companyName?: string
  shortName?: string
  logo?: string
  industry?: string
  scale?: string
  province?: string
  city?: string
  address?: string
  contactName?: string
  contactPhone?: string
  contactEmail?: string
  website?: string
  description?: string
  status?: number
}

interface ExistRow extends RowDataPacket {
  id: number
}

const fieldMap: Record<string, string> = {
  companyName: 'company_name',
  shortName: 'short_name',
  logo: 'logo',
  industry: 'industry',
  scale: 'scale',
  province: 'province',
  city: 'city',
  address: 'address',
  contactName: 'contact_name',
  contactPhone: 'contact_phone',
  contactEmail: 'contact_email',
  website: 'website',
  description: 'description',
  status: 'status'
}

export default defineEventHandler(async (event) => {
  const companyCode = getRouterParam(event, 'companyCode')

  if (!companyCode) {
    throw createError({
      statusCode: 400,
      message: '公司编码不能为空'
    })
  }

  const body = await readBody<UpdateCompanyBody>(event)

  try {
    const existing = await queryRows<ExistRow[]>(
      'SELECT id FROM companies WHERE company_code = ?',
      [companyCode]
    )

    if (existing.length === 0) {
      throw createError({
        statusCode: 404,
        message: '公司不存在'
      })
    }

    // 动态构建 UPDATE 语句
    const sets: string[] = []
    const params: unknown[] = []

    for (const [key, col] of Object.entries(fieldMap)) {
      if (body[key as keyof UpdateCompanyBody] !== undefined) {
        sets.push(`${col} = ?`)
        params.push(body[key as keyof UpdateCompanyBody])
      }
    }

    if (sets.length === 0) {
      return { code: 0, message: '无需更新' }
    }

    params.push(companyCode)
    await execute<ResultSetHeader>(
      `UPDATE companies SET ${sets.join(', ')} WHERE company_code = ?`,
      params
    )

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'company.update',
      targetType: 'company',
      targetId: companyCode,
      detail: { ...body }
    })

    return {
      code: 0,
      message: '更新成功'
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to update company:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '更新公司失败'
    })
  }
})
