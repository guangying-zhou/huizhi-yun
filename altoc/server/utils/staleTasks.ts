import { createError } from 'h3'

export interface StaleOpportunityScanResult {
  scanned: number
  stale_ids: number[]
  notified_owners: number
}

export async function scanAndNotifyStaleOpportunities(_staleDays: number = 7): Promise<StaleOpportunityScanResult> {
  throw createError({
    statusCode: 500,
    message: 'Local stale opportunity scan DB helper is retired. Use Altoc scheduled tenant-runtime commands.'
  })
}
