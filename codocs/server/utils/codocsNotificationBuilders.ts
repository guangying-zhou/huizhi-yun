import { createHash } from 'node:crypto'
import { createError, getHeader, type H3Event } from 'h3'
import type { NotifyParams } from '@hzy/foundation/server/utils/notify'

export type CodocsNotificationInput = Omit<
  NotifyParams,
  'sourceAppCode' | 'eventType' | 'category' | 'severity' | 'bizType' | 'bizId' | 'idempotencyKey' | 'metadata'
> & {
  eventType: string
  category: string
  severity: NonNullable<NotifyParams['severity']>
  bizType: string
  bizId: string | number
  idempotencyKey: string
  metadata: Record<string, unknown>
}

function identityText(value: unknown): string {
  return String(value ?? '').trim()
}

export function codocsNotificationIdempotencyKey(kind: string, ...identityParts: unknown[]): string {
  const normalizedKind = identityText(kind).toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  const normalizedParts = identityParts.map(identityText)
  if (!normalizedKind || normalizedParts.some(part => !part)) {
    throw new Error('Codocs notification identity requires a kind and non-empty stable parts')
  }
  const digest = createHash('sha256').update(JSON.stringify(normalizedParts)).digest('hex')
  return `codocs:${normalizedKind}:${digest}`
}

export function buildCodocsNotification(input: CodocsNotificationInput): NotifyParams {
  return {
    ...input,
    sourceAppCode: 'codocs'
  }
}

export function requireCodocsNotificationRequestKey(event: H3Event, label: string): string {
  const requestKey = identityText(getHeader(event, 'idempotency-key'))
  if (!requestKey) {
    throw createError({
      statusCode: 400,
      message: `${label} requires Idempotency-Key`
    })
  }
  return requestKey
}
