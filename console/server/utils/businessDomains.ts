import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow, queryRows } from '~~/server/utils/db'

interface BusinessDomainQuery {
  category?: string
  status?: string
  search?: string
  keyword?: string
}

interface ColumnCountRow extends RowDataPacket {
  count: number
}

interface BusinessDomainRow extends RowDataPacket {
  id: number
  domain_code: string
  domain_name: string
  category: string | null
  alias_name: string | null
  source: string
  parent_domain_code: string | null
  description: string | null
  sort_order: number
  status: string
}

let hasCategoryColumnCache: boolean | null = null
let hasAliasNameColumnCache: boolean | null = null

async function hasColumn(columnName: string) {
  const row = await queryRow<ColumnCountRow>(
    `SELECT COUNT(*) AS count
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'org_business_domains'
        AND COLUMN_NAME = ?`,
    [columnName]
  )

  return Number(row?.count || 0) > 0
}

async function hasCategoryColumn() {
  if (hasCategoryColumnCache !== null) return hasCategoryColumnCache
  hasCategoryColumnCache = await hasColumn('category')
  return hasCategoryColumnCache
}

async function hasAliasNameColumn() {
  if (hasAliasNameColumnCache !== null) return hasAliasNameColumnCache
  hasAliasNameColumnCache = await hasColumn('alias_name')
  return hasAliasNameColumnCache
}

function inferCategory(row: Pick<BusinessDomainRow, 'category' | 'domain_code' | 'parent_domain_code'>): '2G' | '2B' | '2C' {
  if (row.category === '2G' || row.category === '2B' || row.category === '2C') return row.category

  const source = row.parent_domain_code || row.domain_code
  if (source === 'GOV' || source.startsWith('GOV_')) return '2G'
  if (source === 'CON' || source.startsWith('CON_')) return '2C'
  return '2B'
}

function nullableString(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function sourceToAccount(source: string | null | undefined) {
  return source === 'custom' ? 'custom' : 'preset'
}

function normalizeBusinessDomain(row: BusinessDomainRow, companyCode: string | null = null) {
  const aliasName = row.alias_name || null
  const domainName = row.domain_name
  return {
    id: row.id,
    companyCode,
    domainCode: row.domain_code,
    domainName,
    category: inferCategory(row),
    aliasName,
    displayName: aliasName || domainName,
    source: sourceToAccount(row.source),
    parentCode: row.parent_domain_code,
    description: row.description,
    sortOrder: row.sort_order,
    status: row.status === 'active' ? 1 : 0
  }
}

export async function listBusinessDomains(query: BusinessDomainQuery = {}) {
  const hasCategory = await hasCategoryColumn()
  const hasAliasName = await hasAliasNameColumn()
  const params: unknown[] = []
  let sql = `SELECT
      d.id,
      d.domain_code,
      d.domain_name,
      ${hasCategory ? 'd.category' : 'NULL'} AS category,
      ${hasAliasName ? 'd.alias_name' : 'NULL'} AS alias_name,
      d.source,
      p.domain_code AS parent_domain_code,
      d.description,
      d.sort_order,
      d.status
    FROM org_business_domains d
    LEFT JOIN org_business_domains p ON p.id = d.parent_id
    WHERE 1=1`

  const status = String(query.status || 'active').trim()
  if (status !== 'all') {
    sql += ' AND d.status = ?'
    params.push(status)
  }

  const category = String(query.category || '').trim()
  if (category && hasCategory) {
    sql += ' AND d.category = ?'
    params.push(category)
  }

  const search = String(query.search || query.keyword || '').trim()
  if (search) {
    sql += ' AND (d.domain_code LIKE ? OR d.domain_name LIKE ?)'
    params.push(`%${search}%`, `%${search}%`)
  }

  sql += ` ORDER BY
    CASE COALESCE(p.domain_code, d.domain_code)
      WHEN 'GOV' THEN 1
      WHEN 'BIZ' THEN 2
      WHEN 'CON' THEN 3
      ELSE 9
    END ASC,
    d.sort_order ASC,
    d.domain_code ASC`

  const rows = await queryRows<BusinessDomainRow[]>(sql, params)
  const items = rows
    .map(row => normalizeBusinessDomain(row))
    .filter(item => !category || item.category === category)

  return items
}

export async function listCompanyBusinessDomains(companyCode: string) {
  const rows = await queryRows<BusinessDomainRow[]>(
    `SELECT
       d.id,
       d.domain_code,
       d.domain_name,
       ${await hasCategoryColumn() ? 'd.category' : 'NULL'} AS category,
       ${await hasAliasNameColumn() ? 'd.alias_name' : 'NULL'} AS alias_name,
       d.source,
       p.domain_code AS parent_domain_code,
       d.description,
       d.sort_order,
       d.status
     FROM org_business_domains d
     LEFT JOIN org_business_domains p ON p.id = d.parent_id
     WHERE d.status = 'active'
       AND (
         d.parent_id IS NOT NULL
         OR d.source = 'custom'
         OR d.domain_code NOT IN ('GOV', 'BIZ', 'CON')
       )
     ORDER BY d.sort_order ASC, d.domain_code ASC`
  )

  return rows.map(row => normalizeBusinessDomain(row, companyCode))
}

type UpsertBusinessDomainInput = {
  domainCode?: string
  domainName?: string
  category?: '2G' | '2B' | '2C' | string
  source?: string
  sortOrder?: number
}

export async function createCompanyBusinessDomains(input: UpsertBusinessDomainInput | { domains?: UpsertBusinessDomainInput[] }) {
  const domains = Array.isArray((input as { domains?: UpsertBusinessDomainInput[] }).domains)
    ? (input as { domains: UpsertBusinessDomainInput[] }).domains
    : [input as UpsertBusinessDomainInput]

  if (domains.length === 0) return 0

  const hasCategory = await hasCategoryColumn()
  let count = 0
  for (const domain of domains) {
    const domainCode = nullableString(domain.domainCode)
    const domainName = nullableString(domain.domainName)
    if (!domainCode || !domainName) {
      throw createError({ statusCode: 400, message: '领域编码和名称不能为空' })
    }

    const columns = ['domain_code', 'domain_name', 'source', 'sort_order', 'status', 'created_at', 'updated_at']
    const placeholders = ['?', '?', '?', '?', '\'active\'', 'NOW()', 'NOW()']
    const params: unknown[] = [
      domainCode,
      domainName,
      domain.source === 'custom' ? 'custom' : 'preset',
      domain.sortOrder ?? 100
    ]

    if (hasCategory) {
      columns.splice(2, 0, 'category')
      placeholders.splice(2, 0, '?')
      params.splice(2, 0, domain.category || '2B')
    }

    const categoryUpdate = hasCategory ? 'category = VALUES(category),' : ''
    const result = await execute<ResultSetHeader>(
      `INSERT INTO org_business_domains (${columns.join(', ')})
       VALUES (${placeholders.join(', ')})
       ON DUPLICATE KEY UPDATE
         domain_name = VALUES(domain_name),
         ${categoryUpdate}
         source = VALUES(source),
         sort_order = VALUES(sort_order),
         status = 'active',
         updated_at = NOW()`,
      params
    )
    count += result.affectedRows > 0 ? 1 : 0
  }

  return count
}

export async function updateCompanyBusinessDomain(domainCode: string, input: { aliasName?: string | null, sortOrder?: number }) {
  const sets: string[] = []
  const params: unknown[] = []

  if (input.aliasName !== undefined && await hasAliasNameColumn()) {
    sets.push('alias_name = ?')
    params.push(nullableString(input.aliasName))
  }
  if (input.sortOrder !== undefined) {
    sets.push('sort_order = ?')
    params.push(input.sortOrder)
  }

  if (sets.length === 0) return false

  params.push(domainCode)
  const result = await execute<ResultSetHeader>(
    `UPDATE org_business_domains SET ${sets.join(', ')}, updated_at = NOW() WHERE domain_code = ?`,
    params
  )
  if (result.affectedRows === 0) throw createError({ statusCode: 404, message: '业务领域不存在' })
  return true
}

export async function deleteCompanyBusinessDomain(domainCode: string) {
  const result = await execute<ResultSetHeader>(
    'DELETE FROM org_business_domains WHERE domain_code = ?',
    [domainCode]
  )
  if (result.affectedRows === 0) throw createError({ statusCode: 404, message: '业务领域不存在' })
}
