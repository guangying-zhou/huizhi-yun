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
