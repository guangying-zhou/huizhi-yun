import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, withTransaction } from '~~/server/utils/db'
import { normalizeNullableString } from '~~/server/utils/api'
import { contractOk, resolveDeploymentForV1 } from '~~/server/utils/controlPlaneV1'

interface SubjectSyncItem {
  subjectType?: unknown
  subjectCode?: unknown
  externalRef?: unknown
  parentSubjectType?: unknown
  parentSubjectCode?: unknown
  status?: unknown
  snapshotHash?: unknown
}

interface SubjectMembershipSyncItem {
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

const ALLOWED_SUBJECT_TYPES = new Set(['user', 'department', 'committee', 'job'])
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

function itemSortWeight(item: NormalizedSubjectSyncItem) {
  if (item.subjectType === 'department') return 0
  if (item.subjectType === 'committee') return 0
  if (item.subjectType === 'job') return 1
  return 2
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

function normalizeItem(item: SubjectSyncItem): NormalizedSubjectSyncItem | null {
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

function normalizeMembership(item: SubjectMembershipSyncItem): NormalizedSubjectMembershipSyncItem | null {
  const subjectType = normalizeSubjectType(item.subjectType)
  const subjectCode = normalizeString(item.subjectCode)
  const containerSubjectType = normalizeSubjectType(item.containerSubjectType)
  const containerSubjectCode = normalizeString(item.containerSubjectCode)

  if (!subjectType || !subjectCode || !containerSubjectType || !containerSubjectCode) {
    return null
  }

  if (subjectType === containerSubjectType && subjectCode === containerSubjectCode) {
    return null
  }

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

function membershipKey(item: NormalizedSubjectMembershipSyncItem) {
  return [
    item.subjectType,
    item.subjectCode,
    item.containerSubjectType,
    item.containerSubjectCode,
    item.relationType
  ].join('::')
}

function parentMembershipFromItem(item: NormalizedSubjectSyncItem): NormalizedSubjectMembershipSyncItem | null {
  if (!item.parentSubjectType || !item.parentSubjectCode) return null

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
  const row = await queryRow<TableExistsRow>(
    `SELECT TABLE_NAME AS tableName
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'tenant_subject_memberships'
      LIMIT 1`
  )

  return Boolean(row)
}

async function resolveParentSubjectId(input: {
  tenantCode: string
  item: NormalizedSubjectSyncItem
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
}) {
  const { tenantCode, item } = input
  if (!item.parentSubjectType || !item.parentSubjectCode) return null
  if (item.parentSubjectType === item.subjectType && item.parentSubjectCode === item.subjectCode) return null

  const parent = await input.queryRow<SubjectRow>(
    `SELECT id
       FROM tenant_subjects
      WHERE tenant_code = ?
        AND subject_type = ?
        AND subject_code = ?
      LIMIT 1`,
    [tenantCode, item.parentSubjectType, item.parentSubjectCode]
  )

  return parent?.id || null
}

async function resolveSubjectId(input: {
  tenantCode: string
  subjectType: string
  subjectCode: string
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
}) {
  const row = await input.queryRow<SubjectRow>(
    `SELECT id
       FROM tenant_subjects
      WHERE tenant_code = ?
        AND subject_type = ?
        AND subject_code = ?
      LIMIT 1`,
    [input.tenantCode, input.subjectType, input.subjectCode]
  )

  return row?.id || null
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const deployment = await resolveDeploymentForV1(event, {
    deploymentId: body.deploymentId || body.deploymentCode,
    tenantCode: body.tenantCode
  })
  const tenantCode = deployment.tenant_code
  const items = Array.isArray(body.items) ? body.items as SubjectSyncItem[] : []
  const normalizedItems = items
    .map(normalizeItem)
    .filter((item): item is NormalizedSubjectSyncItem => Boolean(item))
    .sort((a, b) => itemSortWeight(a) - itemSortWeight(b))
  const rawMemberships = Array.isArray(body.memberships) ? body.memberships as SubjectMembershipSyncItem[] : []
  const normalizedMemberships = rawMemberships
    .map(normalizeMembership)
    .filter((item): item is NormalizedSubjectMembershipSyncItem => Boolean(item))

  let upsertedCount = 0
  let membershipUpsertedCount = 0
  let membershipSyncStatus: 'applied' | 'table_missing' = 'table_missing'

  await withTransaction(async (tx) => {
    for (const item of normalizedItems) {
      const parentSubjectId = await resolveParentSubjectId({
        tenantCode,
        item,
        queryRow: tx.queryRow
      })
      const displayName = item.subjectType === 'user' ? null : item.subjectCode
      const result = await tx.execute<ResultSetHeader>(
        `INSERT INTO tenant_subjects
          (tenant_code, subject_type, subject_code, display_name, external_ref, parent_subject_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           display_name = VALUES(display_name),
           external_ref = VALUES(external_ref),
           parent_subject_id = VALUES(parent_subject_id),
           status = VALUES(status),
           updated_at = NOW()`,
        [
          tenantCode,
          item.subjectType,
          item.subjectCode,
          displayName,
          item.externalRef,
          parentSubjectId,
          item.status
        ]
      )

      if (result.affectedRows > 0) {
        upsertedCount += 1
      }

      if (item.subjectType === 'committee') {
        await tx.execute<ResultSetHeader>(
          `UPDATE tenant_subjects
           SET status = 'disabled',
               updated_at = NOW()
           WHERE tenant_code = ?
             AND subject_type = 'department'
             AND subject_code = ?
             AND status <> 'disabled'`,
          [tenantCode, item.subjectCode]
        )
      }
    }

    if (await membershipTableExists(tx.queryRow)) {
      membershipSyncStatus = 'applied'
      const membershipMap = new Map<string, NormalizedSubjectMembershipSyncItem>()

      for (const item of normalizedItems) {
        const membership = parentMembershipFromItem(item)
        if (membership) {
          membershipMap.set(membershipKey(membership), membership)
        }
      }

      for (const membership of normalizedMemberships) {
        membershipMap.set(membershipKey(membership), membership)
      }

      await tx.execute<ResultSetHeader>(
        `UPDATE tenant_subject_memberships
            SET status = 'inactive',
                updated_at = NOW()
          WHERE tenant_code = ?
            AND source = 'runtime'`,
        [tenantCode]
      )

      for (const membership of membershipMap.values()) {
        const subjectId = await resolveSubjectId({
          tenantCode,
          subjectType: membership.subjectType,
          subjectCode: membership.subjectCode,
          queryRow: tx.queryRow
        })
        const containerSubjectId = await resolveSubjectId({
          tenantCode,
          subjectType: membership.containerSubjectType,
          subjectCode: membership.containerSubjectCode,
          queryRow: tx.queryRow
        })

        if (!subjectId || !containerSubjectId) {
          continue
        }

        const result = await tx.execute<ResultSetHeader>(
          `INSERT INTO tenant_subject_memberships
            (tenant_code, source, subject_id, container_subject_id, relation_type, is_primary, status, created_at, updated_at)
           VALUES (?, 'runtime', ?, ?, ?, ?, ?, NOW(), NOW())
           ON DUPLICATE KEY UPDATE
             is_primary = VALUES(is_primary),
             status = VALUES(status),
             updated_at = NOW()`,
          [
            tenantCode,
            subjectId,
            containerSubjectId,
            membership.relationType,
            membership.isPrimary ? 1 : 0,
            membership.status
          ]
        )

        if (result.affectedRows > 0) {
          membershipUpsertedCount += 1
        }
      }
    }
  })

  const now = new Date()
  await execute<ResultSetHeader>(
    `UPDATE deployments
        SET reported_directory_snapshot_hash = ?,
            reported_directory_sync_cursor = ?,
            last_directory_sync_at = ?,
            directory_sync_status = 'healthy',
            updated_at = NOW()
      WHERE id = ?`,
    [
      normalizeNullableString(body.snapshotHash),
      normalizeNullableString(body.cursor),
      now.toISOString().slice(0, 19).replace('T', ' '),
      deployment.id
    ]
  )

  return contractOk({
    tenantCode,
    deploymentId: deployment.deployment_code,
    receivedCount: items.length,
    acceptedCount: normalizedItems.length,
    skippedCount: items.length - normalizedItems.length,
    upsertedCount,
    membershipReceivedCount: rawMemberships.length,
    membershipAcceptedCount: normalizedMemberships.length,
    membershipUpsertedCount,
    membershipSyncStatus
  })
})
