import { execute, queryRows } from '~~/server/utils/db'
import { logOperationFromEvent } from '~~/server/utils/log'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'

interface AddDomainBody {
  domainCode: string
  domainName: string
  category: '2G' | '2B' | '2C'
  aliasName?: string
  source?: 'preset' | 'custom'
  sortOrder?: number
}

interface BatchAddBody {
  domains: AddDomainBody[]
}

interface DomainDictRow extends RowDataPacket {
  domain_code: string
  domain_name: string
  category: '2G' | '2B' | '2C'
  parent_code: string | null
  sort_order: number
}

async function loadDomainDictRows(codes: string[]) {
  if (codes.length === 0) {
    return []
  }

  const placeholders = codes.map(() => '?').join(', ')

  return queryRows<DomainDictRow[]>(
    `SELECT domain_code, domain_name, category, parent_code, sort_order
     FROM business_domains
     WHERE status = 1 AND domain_code IN (${placeholders})`,
    codes
  )
}

async function expandDomainsWithParents(domains: AddDomainBody[]) {
  const dictCodes = [...new Set(
    domains
      .filter(domain => (domain.source || 'preset') === 'preset')
      .map(domain => domain.domainCode)
  )]

  const dictByCode = new Map<string, DomainDictRow>()
  let frontier = dictCodes

  while (frontier.length > 0) {
    const codesToFetch = frontier.filter(code => !dictByCode.has(code))
    if (codesToFetch.length === 0) {
      break
    }

    const rows = await loadDomainDictRows(codesToFetch)
    frontier = []

    for (const row of rows) {
      dictByCode.set(row.domain_code, row)
      if (row.parent_code && !dictByCode.has(row.parent_code)) {
        frontier.push(row.parent_code)
      }
    }
  }

  const expanded = new Map<string, AddDomainBody>()

  for (const domain of domains) {
    expanded.set(domain.domainCode, {
      ...domain,
      source: domain.source || 'preset',
      sortOrder: domain.sortOrder ?? 0
    })

    if ((domain.source || 'preset') !== 'preset') {
      continue
    }

    let current = dictByCode.get(domain.domainCode)

    while (current?.parent_code) {
      const parent = dictByCode.get(current.parent_code)
      if (!parent) {
        break
      }

      if (!expanded.has(parent.domain_code)) {
        expanded.set(parent.domain_code, {
          domainCode: parent.domain_code,
          domainName: parent.domain_name,
          category: parent.category,
          source: 'preset',
          sortOrder: parent.sort_order
        })
      }

      current = parent
    }
  }

  return [...expanded.values()]
}

export default defineEventHandler(async (event) => {
  const companyCode = getRouterParam(event, 'companyCode')

  if (!companyCode) {
    throw createError({
      statusCode: 400,
      message: '公司编码不能为空'
    })
  }

  const body = await readBody<AddDomainBody | BatchAddBody>(event)

  // 支持单条和批量
  const domains = 'domains' in body ? body.domains : [body]

  if (domains.length === 0) {
    throw createError({
      statusCode: 400,
      message: '请至少选择一个领域'
    })
  }

  for (const d of domains) {
    if (!d.domainCode || !d.domainName || !d.category) {
      throw createError({
        statusCode: 400,
        message: '领域编码、名称和大类不能为空'
      })
    }
  }

  try {
    const expandedDomains = await expandDomainsWithParents(domains)

    const values = expandedDomains.map(d => [
      companyCode,
      d.domainCode,
      d.domainName,
      d.category,
      d.aliasName || null,
      d.source || 'preset',
      d.sortOrder ?? 0
    ])

    const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')
    const flatParams = values.flat()

    const result = await execute<ResultSetHeader>(
      `INSERT INTO company_business_domains (company_code, domain_code, domain_name, category, alias_name, source, sort_order)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE domain_name = VALUES(domain_name), alias_name = VALUES(alias_name), sort_order = VALUES(sort_order), status = 1`,
      flatParams
    )

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'company_domain.add',
      targetType: 'company_business_domain',
      targetId: companyCode,
      detail: {
        requestedDomains: domains.map(d => d.domainCode),
        savedDomains: expandedDomains.map(d => d.domainCode)
      }
    })

    return {
      code: 0,
      message: `成功添加 ${expandedDomains.length} 个领域`,
      data: {
        affectedRows: result.affectedRows,
        requestedCount: domains.length,
        savedCount: expandedDomains.length
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to add company business domains:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '添加业务领域失败'
    })
  }
})
