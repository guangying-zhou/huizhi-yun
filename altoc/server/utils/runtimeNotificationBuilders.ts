import { createHash } from 'node:crypto'
import type { NotifyParams } from '@hzy/foundation/server/utils/notify'

export interface OpportunityStaleNotice {
  id: number
  code: string
  name: string
  owner_user_id?: string | null
  days_stale: number
}

interface AssignmentEventNotice {
  notification_event_version?: string | number | null
  notificationEventVersion?: string | number | null
}

export interface LeadAssignedNotice extends AssignmentEventNotice {
  id: number
  code?: string | null
  name: string
  owner_user_id?: string | null
}

export interface OpportunityAssignedNotice extends AssignmentEventNotice {
  id: number
  code?: string | null
  name: string
  owner_user_id?: string | null
  customer_name?: string | null
  amount_tax_inclusive?: number | string | null
}

export interface BestEffortNotificationDependencies {
  send: (params: NotifyParams) => Promise<unknown>
  onError?: (error: unknown, params: NotifyParams) => void
}

export class MissingAssignmentEventVersionError extends Error {
  readonly code = 'missing_assignment_event_version'

  constructor(entityType: 'lead' | 'opportunity', entityId: number) {
    super(`Missing stable assignment event version for ${entityType} ${entityId}`)
    this.name = 'MissingAssignmentEventVersionError'
  }
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function codePrefix(code: string | null | undefined): string {
  const value = text(code)
  return value ? `[${value}] ` : ''
}

function assignmentEventVersion(
  notice: AssignmentEventNotice,
  explicitVersion?: string | number | null
): string {
  return text(explicitVersion ?? notice.notification_event_version ?? notice.notificationEventVersion)
}

function assignmentIdempotencyKey(
  bizType: 'lead' | 'opportunity',
  bizId: number,
  assigneeUid: string,
  eventVersion: string
): string {
  return `altoc:${bizType}:assigned:${bizId}:${assigneeUid}:${hashToken(eventVersion)}`
}

function sortedGroups<T>(
  rows: T[],
  ownerOf: (row: T) => string,
  idOf: (row: T) => number
): Array<[string, T[]]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const ownerUid = ownerOf(row)
    if (!ownerUid) continue
    const list = grouped.get(ownerUid) || []
    list.push(row)
    grouped.set(ownerUid, list)
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([ownerUid, list]) => [
      ownerUid,
      [...list].sort((left, right) => idOf(left) - idOf(right))
    ])
}

function scanCollectionKey(
  scanType: 'receivable-overdue' | 'opportunity-stale',
  scanPeriod: string,
  ownerUid: string,
  itemIds: number[]
): string {
  const collectionHash = hashToken(itemIds.join(','))
  return `altoc:${scanType}:${scanPeriod}:${ownerUid}:${collectionHash}`
}

export function currentUtcScanPeriod(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export function buildLeadAssignmentNotification(
  lead: LeadAssignedNotice | null | undefined,
  assignerUid: string,
  url: string,
  explicitEventVersion?: string | number | null
): NotifyParams | null {
  const assigneeUid = text(lead?.owner_user_id)
  if (!lead || !assigneeUid || assigneeUid === assignerUid) return null

  const eventVersion = assignmentEventVersion(lead, explicitEventVersion)
  if (!eventVersion) throw new MissingAssignmentEventVersionError('lead', lead.id)

  return {
    touser: assigneeUid,
    title: '有新线索分配给你',
    description: `${codePrefix(lead.code)}${lead.name}\n分配人: ${assignerUid}`,
    url,
    btntxt: '查看线索',
    sourceAppCode: 'altoc',
    eventType: 'altoc.lead.assigned',
    category: 'assignment',
    severity: 'info',
    bizType: 'lead',
    bizId: lead.id,
    idempotencyKey: assignmentIdempotencyKey('lead', lead.id, assigneeUid, eventVersion),
    metadata: {
      notificationKind: 'assignment',
      entityType: 'lead',
      entityId: lead.id,
      entityCode: text(lead.code) || null,
      assigneeUid,
      assignerUid,
      eventVersion
    }
  }
}

export function buildOpportunityAssignmentNotification(
  opportunity: OpportunityAssignedNotice | null | undefined,
  assignerUid: string,
  url: string,
  explicitEventVersion?: string | number | null
): NotifyParams | null {
  const assigneeUid = text(opportunity?.owner_user_id)
  if (!opportunity || !assigneeUid || assigneeUid === assignerUid) return null

  const eventVersion = assignmentEventVersion(opportunity, explicitEventVersion)
  if (!eventVersion) throw new MissingAssignmentEventVersionError('opportunity', opportunity.id)

  const amount = Number(opportunity.amount_tax_inclusive || 0)
  const amountText = Number.isFinite(amount) && amount > 0
    ? `¥${amount.toLocaleString('zh-CN')}`
    : '金额待定'
  const customerText = opportunity.customer_name ? ` / ${opportunity.customer_name}` : ''

  return {
    touser: assigneeUid,
    title: '有新商机分配给你',
    description: `${codePrefix(opportunity.code)}${opportunity.name}${customerText}\n预期金额: ${amountText}\n分配人: ${assignerUid}`,
    url,
    btntxt: '查看商机',
    sourceAppCode: 'altoc',
    eventType: 'altoc.opportunity.assigned',
    category: 'assignment',
    severity: 'info',
    bizType: 'opportunity',
    bizId: opportunity.id,
    idempotencyKey: assignmentIdempotencyKey('opportunity', opportunity.id, assigneeUid, eventVersion),
    metadata: {
      notificationKind: 'assignment',
      entityType: 'opportunity',
      entityId: opportunity.id,
      entityCode: text(opportunity.code) || null,
      assigneeUid,
      assignerUid,
      eventVersion
    }
  }
}

export function buildOpportunityStaleNotifications(
  rows: OpportunityStaleNotice[],
  scanPeriod: string,
  url: string
): NotifyParams[] {
  const normalizedPeriod = text(scanPeriod)
  if (!normalizedPeriod) return []

  return sortedGroups(rows, row => text(row.owner_user_id), row => row.id)
    .map(([ownerUid, list]) => {
      const itemIds = list.map(row => row.id)
      const preview = list.slice(0, 3).map((row, index) =>
        `${index + 1}. [${row.code}] ${row.name} (${row.days_stale}天未跟进)`
      ).join('\n')
      const more = list.length > 3 ? `\n...等共 ${list.length} 条` : ''

      return {
        touser: ownerUid,
        title: `你有 ${list.length} 个商机超期未跟进`,
        description: `请及时更新跟进状态：\n\n${preview}${more}`,
        url,
        btntxt: '立即跟进',
        sourceAppCode: 'altoc',
        eventType: 'altoc.opportunity.stale',
        category: 'opportunity',
        severity: 'warning',
        bizType: 'opportunity_stale_scan',
        bizId: `${normalizedPeriod}:${ownerUid}`,
        idempotencyKey: scanCollectionKey('opportunity-stale', normalizedPeriod, ownerUid, itemIds),
        metadata: {
          notificationKind: 'scan',
          scanType: 'opportunity_stale',
          scanPeriod: normalizedPeriod,
          ownerUid,
          itemIds,
          itemCount: itemIds.length
        }
      }
    })
}

export async function deliverNotificationsBestEffort(
  notifications: NotifyParams[],
  dependencies: BestEffortNotificationDependencies
): Promise<number> {
  let delivered = 0
  for (const notification of notifications) {
    try {
      await dependencies.send(notification)
      delivered += 1
    } catch (error: unknown) {
      dependencies.onError?.(error, notification)
    }
  }
  return delivered
}
