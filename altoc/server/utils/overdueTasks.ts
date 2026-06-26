import { createError } from 'h3'

export interface OverdueScanResult {
  scanned: number
  marked_overdue: number
  updated_days: number
  notified_owners: number
}

export async function scanAndMarkOverdue(_operatorId: string = 'system'): Promise<OverdueScanResult> {
  throw createError({
    statusCode: 500,
    message: 'Local overdue scan DB helper is retired. Use Altoc scheduled tenant-runtime commands.'
  })
}
