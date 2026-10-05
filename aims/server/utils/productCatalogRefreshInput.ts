export interface CatalogRefreshState {
  refresh_id: string
  status: 'staging' | 'active' | 'superseded' | 'failed'
  watermark: string | null
  row_count: number
  revision: number
  next_page: number
  total: number
}
export function catalogRefreshInput(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (!['start', 'continue', 'status', 'cancel'].includes(value.action as string)) return null
  if (Object.keys(value).some(key => !['action', 'refreshId', 'expectedRevision'].includes(key))) return null
  if (value.action === 'start') return value.refreshId === undefined && value.expectedRevision === undefined ? { action: 'start' as const, refreshId: '', expectedRevision: 0 } : null
  if (typeof value.refreshId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.refreshId)) return null
  if (value.action === 'continue' && (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 1)) return null
  if (value.action !== 'continue' && value.expectedRevision !== undefined) return null
  return { action: value.action as 'continue' | 'status' | 'cancel', refreshId: value.refreshId, expectedRevision: Number(value.expectedRevision || 0) }
}
