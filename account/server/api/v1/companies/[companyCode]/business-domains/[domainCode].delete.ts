import { queryRows, execute } from '~~/server/utils/db'
import { logOperationFromEvent } from '~~/server/utils/log'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'

interface ExistRow extends RowDataPacket {
  id: number
}

interface DomainDictRow extends RowDataPacket {
  domain_code: string
  parent_code: string | null
}

interface CompanyDomainRow extends RowDataPacket {
  domain_code: string
  source: 'preset' | 'custom'
}

function getAncestorCodes(domainCode: string, dictByCode: Map<string, DomainDictRow>) {
  const ancestors: string[] = []
  let current = dictByCode.get(domainCode)

  while (current?.parent_code) {
    ancestors.push(current.parent_code)
    current = dictByCode.get(current.parent_code)
  }

  return ancestors
}

function hasSelectedDescendant(
  domainCode: string,
  selectedDomains: Map<string, 'preset' | 'custom'>,
  childrenByParent: Map<string, string[]>
) {
  const stack = [...(childrenByParent.get(domainCode) || [])]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue

    if (selectedDomains.has(current)) {
      return true
    }

    stack.push(...(childrenByParent.get(current) || []))
  }

  return false
}

export default defineEventHandler(async (event) => {
  const companyCode = getRouterParam(event, 'companyCode')
  const domainCode = getRouterParam(event, 'domainCode')

  if (!companyCode || !domainCode) {
    throw createError({
      statusCode: 400,
      message: '公司编码和领域编码不能为空'
    })
  }

  try {
    const existing = await queryRows<ExistRow[]>(
      'SELECT id FROM company_business_domains WHERE company_code = ? AND domain_code = ?',
      [companyCode, domainCode]
    )

    if (existing.length === 0) {
      throw createError({
        statusCode: 404,
        message: '该领域不存在'
      })
    }

    await execute<ResultSetHeader>(
      'DELETE FROM company_business_domains WHERE company_code = ? AND domain_code = ?',
      [companyCode, domainCode]
    )

    const dictRows = await queryRows<DomainDictRow[]>(
      `SELECT domain_code, parent_code
       FROM business_domains
       WHERE status = 1`
    )

    const dictByCode = new Map(dictRows.map(row => [row.domain_code, row]))
    const childrenByParent = new Map<string, string[]>()

    for (const row of dictRows) {
      if (!row.parent_code) continue
      const siblings = childrenByParent.get(row.parent_code) || []
      siblings.push(row.domain_code)
      childrenByParent.set(row.parent_code, siblings)
    }

    const companyDomains = await queryRows<CompanyDomainRow[]>(
      `SELECT domain_code, source
       FROM company_business_domains
       WHERE company_code = ? AND status = 1`,
      [companyCode]
    )

    const selectedDomains = new Map(
      companyDomains.map(row => [row.domain_code, row.source])
    )

    const ancestorsToRemove: string[] = []
    for (const ancestorCode of getAncestorCodes(domainCode, dictByCode)) {
      if (selectedDomains.get(ancestorCode) !== 'preset') {
        continue
      }

      if (hasSelectedDescendant(ancestorCode, selectedDomains, childrenByParent)) {
        continue
      }

      ancestorsToRemove.push(ancestorCode)
      selectedDomains.delete(ancestorCode)
    }

    if (ancestorsToRemove.length > 0) {
      const placeholders = ancestorsToRemove.map(() => '?').join(', ')
      await execute<ResultSetHeader>(
        `DELETE FROM company_business_domains
         WHERE company_code = ? AND domain_code IN (${placeholders})`,
        [companyCode, ...ancestorsToRemove]
      )
    }

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'company_domain.delete',
      targetType: 'company_business_domain',
      targetId: `${companyCode}:${domainCode}`,
      detail: {
        removedDomain: domainCode,
        cleanupAncestors: ancestorsToRemove
      }
    })

    return {
      code: 0,
      message: '删除成功'
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to delete company business domain:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '删除业务领域失败'
    })
  }
})
