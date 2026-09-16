import type { H3Event } from 'h3'
import { getQuery } from 'h3'

export interface PageParams {
  page: number
  pageSize: number
  offset: number
}

export interface ApiListResult<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  warning?: string
}

export interface ApiDataResult<T> {
  data: T
  warning?: string
}

export function getPageParams(event: H3Event): PageParams {
  const query = getQuery(event)
  const page = clampNumber(Number(query.page || 1), 1, 100000)
  const pageSize = clampNumber(Number(query.pageSize || 20), 1, 100)

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize
  }
}

export function getStringQuery(event: H3Event, key: string): string {
  const value = getQuery(event)[key]
  return Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim()
}

export function likeKeyword(value: string): string {
  return `%${value.replace(/[%_]/g, char => `\\${char}`)}%`
}

export function isMissingSchemaError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'ER_NO_SUCH_TABLE'
    || code === 'ECONNREFUSED'
    || code === 'ENOTFOUND'
    || code === 'ETIMEDOUT'
}

export function missingSchemaWarning(error: unknown): string | undefined {
  if (!isMissingSchemaError(error)) return undefined
  const code = (error as { code?: string } | null)?.code
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
    return 'Finance tenant-runtime 暂不可连接，已返回空数据。请检查 HZY_TENANT_RUNTIME_URL 和 runtime 服务状态。'
  }
  return 'Finance runtime 数据库尚未初始化，已返回空数据。请先在 tenant-runtime 侧完成 schema 初始化。'
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.floor(value), min), max)
}
