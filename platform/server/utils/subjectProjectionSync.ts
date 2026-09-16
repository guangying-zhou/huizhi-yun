import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString } from '~~/server/utils/api'
import { execute, withTransaction } from '~~/server/utils/db'

export interface SubjectProjectionSyncItem {
  subjectType?: unknown
  subjectCode?: unknown
  externalRef?: unknown
  parentSubjectType?: unknown
  parentSubjectCode?: unknown
  status?: unknown
  snapshotHash?: unknown
}

export interface SubjectProjectionMembershipItem {
  subjectType?: unknown
  subjectCode?: unknown
  containerSubjectType?: unknown
  containerSubjectCode?: unknown
  relationType?: unknown
  isPrimary?: unknown
  status?: unknown
}

interface SubjectRow extends RowDataPacket {
  id: number
}

interface TableExistsRow extends RowDataPacket {
  tableName: string
}

interface NormalizedSubjectSyncItem {
  subjectType: string
  subjectCode: string
  externalRef: string | null
  parentSubjectType: string | null
  parentSubjectCode: string | null
  status: string
  snapshotHash: string | null
}

interface NormalizedSubjectMembershipSyncItem {
  subjectType: string
  subjectCode: string
  containerSubjectType: string
  containerSubjectCode: string
  relationType: string
  isPrimary: boolean
  status: string
}

const ALLOWED_SUBJECT_TYPES = new Set(['user', 'department', 'committee', 'job', 'project'])
const ALLOWED_RELATION_TYPES = new Set(['member', 'manager', 'leader', 'observer'])
const STATUS_MAP: Record<string, string> = {
  active: 'active',
  suspended: 'suspended',
  disabled: 'disabled',
  inactive: 'disabled',
  pending: 'disabled',
  deleted: 'disabled',
  archived: 'disabled'
}

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function normalizeSubjectType(value: unknown) {
  const subjectType = normalizeString(value)
  return ALLOWED_SUBJECT_TYPES.has(subjectType) ? subjectType : ''
}

function normalizeStatus(value: unknown) {
  return STATUS_MAP[normalizeString(value)] || 'disabled'
}

function normalizeItem(item: SubjectProjectionSyncItem): NormalizedSubjectSyncItem | null {
  const subjectType = normalizeSubjectType(item.subjectType)
  const subjectCode = normalizeString(item.subjectCode)
  if (!subjectType || !subjectCode) return null

  const parentSubjectType = normalizeSubjectType(item.parentSubjectType) || null
  const parentSubjectCode = normalizeNullableString(item.parentSubjectCode)

  return {
    subjectType,
    subjectCode,
    externalRef: normalizeNullableString(item.externalRef),
    parentSubjectType,
    parentSubjectCode: parentSubjectType && parentSubjectCode ? parentSubjectCode : null,
    status: normalizeStatus(item.status),
    snapshotHash: normalizeNullableString(item.snapshotHash)
  }
}

function normalizeRelationType(value: unknown) {
  const relationType = normalizeString(value) || 'member'
  return ALLOWED_RELATION_TYPES.has(relationType) ? relationType : 'member'
}

function normalizeBoolean(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function normalizeMembership(item: SubjectProjectionMembershipItem): NormalizedSubjectMembershipSyncItem | null {
  const subjectType = normalizeSubjectType(item.subjectType)
  const subjectCode = normalizeString(item.subjectCode)
  const containerSubjectType = normalizeSubjectType(item.containerSubjectType)
  const containerSubjectCode = normalizeString(item.containerSubjectCode)

  if (!subjectType || !subjectCode || !containerSubjectType || !containerSubjectCode) return null
  if (subjectType === containerSubjectType && subjectCode === containerSubjectCode) return null

  return {
    subjectType,
    subjectCode,
    containerSubjectType,
    containerSubjectCode,
    relationType: normalizeRelationType(item.relationType),
    isPrimary: normalizeBoolean(item.isPrimary),
    status: normalizeStatus(item.status)
  }
}

function itemSortWeight(item: NormalizedSubjectSyncItem) {
  if (item.subjectType === 'department' || item.subjectType === 'committee') return 0
  if (item.subjectType === 'job' || item.subjectType === 'project') return 1
  return 2
}

function membershipKey(item: NormalizedSubjectMembershipSyncItem) {
  return [item.subjectType, item.subjectCode, item.containerSubjectType, item.containerSubjectCode, item.relationType].join('::')
}

function parentMembershipFromItem(item: NormalizedSubjectSyncItem): NormalizedSubjectMembershipSyncItem | null {
  if (item.subjectType !== 'user' || !item.parentSubjectType || !item.parentSubjectCode) return null
  return normalizeMembership({
    subjectType: item.subjectType,
    subjectCode: item.subjectCode,
    containerSubjectType: item.parentSubjectType,
    containerSubjectCode: item.parentSubjectCode,
    relationType: 'member',
    isPrimary: true,
    status: item.status
  })
}

async function membershipTableExists(queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>) {
  return Boolean(await queryRow<TableExistsRow>(
    `SELECT TABLE_NAME AS tableName
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'tenant_subject_memberships'
      LIMIT 1`
  ))
}

async function resolveSubjectId(input: {
  tenantCode: string
  subjectType: string
  subjectCode: string
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
}) {
  const row = await input.queryRow<SubjectRow>(
    `SELECT id FROM tenant_subjects
      WHERE tenant_code = ? AND subject_type = ? AND subject_code = ? LIMIT 1`,
    [input.tenantCode, input.subjectType, input.subjectCode]
  )
  return row?.id || null
}

export async function applySubjectProjectionSync(input: {
  tenantCode: string
  deploymentId: number
  deploymentCode: string
  cursor?: unknown
  snapshotHash?: unknown
  items?: SubjectProjectionSyncItem[]
  memberships?: SubjectProjectionMembershipItem[]
  resetMemberships?: unknown
  finalize?: unknown
}) {
  const items = input.items || []
  const normalizedItems = items
    .map(normalizeItem)
    .filter((item): item is NormalizedSubjectSyncItem => Boolean(item))
    .sort((a, b) => itemSortWeight(a) - itemSortWeight(b))
  const memberships = input.memberships || []
  const normalizedMemberships = memberships
    .map(normalizeMembership)
    .filter((item): item is NormalizedSubjectMembershipSyncItem => Boolean(item))
  const resetMemberships = input.resetMemberships !== false
  const finalize = input.finalize !== false

  let upsertedCount = 0
  let membershipUpsertedCount = 0
  let membershipSyncStatus: 'applied' | 'table_missing' = 'table_missing'

  await withTransaction(async (tx) => {
    for (const item of normalizedItems) {
      const parentSubjectId = item.parentSubjectType && item.parentSubjectCode
        && !(item.parentSubjectType === item.subjectType && item.parentSubjectCode === item.subjectCode)
        ? await resolveSubjectId({
            tenantCode: input.tenantCode,
            subjectType: item.parentSubjectType,
            subjectCode: item.parentSubjectCode,
            queryRow: tx.queryRow
          })
        : null
      const displayName = item.subjectType === 'user' ? null : item.subjectCode
      const result = await tx.execute<ResultSetHeader>(
        `INSERT INTO tenant_subjects
          (tenant_code, subject_type, subject_code, display_name, external_ref, parent_subject_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           display_name = VALUES(display_name), external_ref = VALUES(external_ref),
           parent_subject_id = VALUES(parent_subject_id), status = VALUES(status), updated_at = NOW()`,
        [input.tenantCode, item.subjectType, item.subjectCode, displayName, item.externalRef, parentSubjectId, item.status]
      )
      if (result.affectedRows > 0) upsertedCount += 1

      if (item.subjectType === 'project' && item.externalRef) {
        await tx.execute<ResultSetHeader>(
          `UPDATE tenant_subjects SET status = 'disabled', updated_at = NOW()
            WHERE tenant_code = ?
              AND subject_type = 'job'
              AND subject_code = ?
              AND external_ref = ?
              AND status <> 'disabled'`,
          [input.tenantCode, item.subjectCode, item.externalRef]
        )
      }

      if (item.subjectType === 'committee') {
        await tx.execute<ResultSetHeader>(
          `UPDATE tenant_subjects SET status = 'disabled', updated_at = NOW()
            WHERE tenant_code = ? AND subject_type = 'department' AND subject_code = ? AND status <> 'disabled'`,
          [input.tenantCode, item.subjectCode]
        )
      }
    }

    if (await membershipTableExists(tx.queryRow)) {
      membershipSyncStatus = 'applied'
      const membershipMap = new Map<string, NormalizedSubjectMembershipSyncItem>()
      for (const item of normalizedItems) {
        const membership = parentMembershipFromItem(item)
        if (membership) membershipMap.set(membershipKey(membership), membership)
      }
      for (const membership of normalizedMemberships) membershipMap.set(membershipKey(membership), membership)

      if (resetMemberships) {
        await tx.execute<ResultSetHeader>(
          `UPDATE tenant_subject_memberships SET status = 'inactive', updated_at = NOW()
            WHERE tenant_code = ? AND source = 'runtime'`,
          [input.tenantCode]
        )
      }

      for (const membership of membershipMap.values()) {
        const subjectId = await resolveSubjectId({
          tenantCode: input.tenantCode,
          subjectType: membership.subjectType,
          subjectCode: membership.subjectCode,
          queryRow: tx.queryRow
        })
        const containerSubjectId = await resolveSubjectId({
          tenantCode: input.tenantCode,
          subjectType: membership.containerSubjectType,
          subjectCode: membership.containerSubjectCode,
          queryRow: tx.queryRow
        })
        if (!subjectId || !containerSubjectId) continue

        const result = await tx.execute<ResultSetHeader>(
          `INSERT INTO tenant_subject_memberships
            (tenant_code, source, subject_id, container_subject_id, relation_type, is_primary, status, created_at, updated_at)
           VALUES (?, 'runtime', ?, ?, ?, ?, ?, NOW(), NOW())
           ON DUPLICATE KEY UPDATE is_primary = VALUES(is_primary), status = VALUES(status), updated_at = NOW()`,
          [input.tenantCode, subjectId, containerSubjectId, membership.relationType, membership.isPrimary ? 1 : 0, membership.status]
        )
        if (result.affectedRows > 0) membershipUpsertedCount += 1
      }
    }
  })

  if (finalize) {
    await execute<ResultSetHeader>(
      `UPDATE deployments
          SET reported_directory_snapshot_hash = ?, reported_directory_sync_cursor = ?,
              last_directory_sync_at = ?, directory_sync_status = 'healthy', updated_at = NOW()
        WHERE id = ?`,
      [
        normalizeNullableString(input.snapshotHash),
        normalizeNullableString(input.cursor),
        new Date().toISOString().slice(0, 19).replace('T', ' '),
        input.deploymentId
      ]
    )
  } else if (resetMemberships) {
    await execute<ResultSetHeader>(
      `UPDATE deployments SET directory_sync_status = 'syncing', updated_at = NOW() WHERE id = ?`,
      [input.deploymentId]
    )
  }

  return {
    tenantCode: input.tenantCode,
    deploymentId: input.deploymentCode,
    receivedCount: items.length,
    acceptedCount: normalizedItems.length,
    skippedCount: items.length - normalizedItems.length,
    upsertedCount,
    membershipReceivedCount: memberships.length,
    membershipAcceptedCount: normalizedMemberships.length,
    membershipUpsertedCount,
    membershipSyncStatus,
    resetMemberships,
    finalized: finalize
  }
}
