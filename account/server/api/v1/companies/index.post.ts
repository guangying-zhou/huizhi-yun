import { queryRows, execute } from '~~/server/utils/db'
import { logOperationFromEvent } from '~~/server/utils/log'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'

interface CreateCompanyBody {
  companyName: string
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
}

interface MaxCodeRow extends RowDataPacket {
  max_code: string | null
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateCompanyBody>(event)

  if (!body.companyName) {
    throw createError({
      statusCode: 400,
      message: '公司名称不能为空'
    })
  }

  try {
    // 生成公司编码：C + 6位数字
    const [maxRow] = await queryRows<MaxCodeRow[]>(
      'SELECT MAX(company_code) AS max_code FROM companies'
    )
    const maxCode = maxRow?.max_code
    let nextNum = 1
    if (maxCode) {
      nextNum = parseInt(maxCode.substring(1), 10) + 1
    }
    const companyCode = `C${String(nextNum).padStart(6, '0')}`

    const result = await execute<ResultSetHeader>(
      `INSERT INTO companies (company_code, company_name, short_name, logo, industry, scale, province, city, address, contact_name, contact_phone, contact_email, website, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyCode,
        body.companyName,
        body.shortName || null,
        body.logo || null,
        body.industry || null,
        body.scale || null,
        body.province || null,
        body.city || null,
        body.address || null,
        body.contactName || null,
        body.contactPhone || null,
        body.contactEmail || null,
        body.website || null,
        body.description || null
      ]
    )

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'company.create',
      targetType: 'company',
      targetId: companyCode,
      detail: {
        id: result.insertId,
        companyName: body.companyName,
        companyCode
      }
    })

    return {
      code: 0,
      message: '创建成功',
      data: {
        id: result.insertId,
        companyCode
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string, code?: string }
    if (error.statusCode) throw error
    console.error('Failed to create company:', error)

    if (error.code === 'ER_DUP_ENTRY') {
      throw createError({
        statusCode: 400,
        message: '公司编码已存在'
      })
    }

    throw createError({
      statusCode: 500,
      message: error.message || '创建公司失败'
    })
  }
})
