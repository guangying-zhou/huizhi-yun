import { createError } from 'h3'

export interface AuditLogWriteParams {
  entityType: string
  entityId: number
  action: 'create' | 'update' | 'delete' | 'status_change' | 'approve' | 'reject'
  oldValue?: Record<string, unknown> | null
  newValue?: Record<string, unknown> | null
  operatorId: string
  operatorName?: string
  ipAddress?: string
  remark?: string
}

export async function writeAuditLog(_params: AuditLogWriteParams): Promise<void> {
  throw createError({
    statusCode: 500,
    message: 'Local audit log DB helper is retired. Use Altoc tenant-runtime audit commands.'
  })
}
