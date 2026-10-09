import type { AimsProject, ProjectPortfolio } from '../types/aims'

export interface ProjectReadSummary {
  projectCount: number
  portfolioCounts: Record<string, number>
  statusCounts: Record<string, number>
  yearCounts: Record<string, number>
  historicalCounts?: Record<string, number>
  latestByLine: Record<string, number>
}
export interface ProjectOverviewPage {
  items: Array<{ portfolio: ProjectPortfolio, canDelete: boolean }>
  total: number
  page: number
  pageSize: number
  summary: ProjectReadSummary
}
export interface ProjectGroupPage {
  items: AimsProject[]
  total: number
  page: number
  pageSize: number
  summary: ProjectReadSummary
}
export function isProjectProjection<T extends ProjectOverviewPage | ProjectGroupPage>(value: unknown, page: number, size: number): value is T {
  const data = value as T | null
  return !!data && Array.isArray(data.items) && data.items.length <= size && Number.isSafeInteger(data.total) && data.total >= 0
    && data.page === page && data.pageSize === size && Number.isSafeInteger(data.summary?.projectCount)
    && !!data.summary?.portfolioCounts && !!data.summary.statusCounts && !!data.summary.yearCounts && !!data.summary.latestByLine
}

// 项目总览不分页：按服务端单页上限顺序读完全部页并拼接，最多 maxPages 页，防止异常 total 造成请求风暴。
export const projectOverviewReadPageSize = 100
export async function readAllProjectPages<T extends { items: unknown[], total: number, page: number, pageSize: number }>(
  readPage: (page: number) => Promise<T | null>,
  maxPages = 20
): Promise<T | null> {
  const first = await readPage(1)
  if (!first) return null
  const items = [...first.items]
  for (let page = 2; items.length < first.total && page <= maxPages; page++) {
    const next = await readPage(page)
    if (!next) return null
    if (next.items.length === 0) break
    items.push(...next.items)
  }
  return { ...first, items, page: 1, pageSize: Math.max(items.length, 1) }
}
