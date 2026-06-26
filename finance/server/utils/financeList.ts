import type { H3Event } from 'h3'
import type { RowDataPacket } from '~~/server/utils/db'
import { getPageParams, getStringQuery, likeKeyword, missingSchemaWarning, type ApiListResult } from './financeApi'
import { queryRow, queryRows } from './db'
import { maybeCallCurrentFinanceDataRuntime } from './dataRuntime'

export interface FinanceListConfig {
  table: string
  select: string[]
  searchColumns: string[]
  dateColumn?: string
  statusColumn?: string
  defaultOrderBy: string
}

type SqlParam = string | number | boolean | Date | Buffer | null

export async function listFinanceRows<T extends RowDataPacket>(event: H3Event, config: FinanceListConfig): Promise<ApiListResult<T>> {
  const runtime = await maybeCallCurrentFinanceDataRuntime<ApiListResult<T>>(event)
  if (runtime.handled) return runtime.data

  const page = getPageParams(event)
  const where: string[] = []
  const params: SqlParam[] = []

  if (config.select.includes('deleted_at')) {
    where.push('deleted_at IS NULL')
  }

  const keyword = getStringQuery(event, 'keyword')
  if (keyword && config.searchColumns.length > 0) {
    where.push(`(${config.searchColumns.map(column => `${column} LIKE ? ESCAPE '\\\\'`).join(' OR ')})`)
    params.push(...config.searchColumns.map(() => likeKeyword(keyword)))
  }

  const status = getStringQuery(event, 'status')
  if (status && config.statusColumn) {
    where.push(`${config.statusColumn} = ?`)
    params.push(status)
  }

  const dateFrom = getStringQuery(event, 'dateFrom')
  if (dateFrom && config.dateColumn) {
    where.push(`${config.dateColumn} >= ?`)
    params.push(dateFrom)
  }

  const dateTo = getStringQuery(event, 'dateTo')
  if (dateTo && config.dateColumn) {
    where.push(`${config.dateColumn} <= ?`)
    params.push(dateTo)
  }

  const filterableCodes = ['customer_code', 'contract_code', 'project_code', 'department_code', 'employee_uid', 'period_month']
  for (const code of filterableCodes) {
    const value = getStringQuery(event, code)
    if (value && config.select.includes(code)) {
      where.push(`${code} = ?`)
      params.push(value)
    }
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  try {
    const count = await queryRow<RowDataPacket & { total: number }>(
      `SELECT COUNT(*) AS total FROM ${config.table} ${whereSql}`,
      params
    )
    const rows = await queryRows<T[]>(
      `SELECT ${config.select.join(', ')} FROM ${config.table} ${whereSql} ORDER BY ${config.defaultOrderBy} LIMIT ? OFFSET ?`,
      [...params, page.pageSize, page.offset]
    )

    return {
      data: rows,
      total: Number(count?.total || 0),
      page: page.page,
      pageSize: page.pageSize
    }
  } catch (error) {
    const warning = missingSchemaWarning(error)
    if (!warning) throw error
    return {
      data: [],
      total: 0,
      page: page.page,
      pageSize: page.pageSize,
      warning
    }
  }
}
