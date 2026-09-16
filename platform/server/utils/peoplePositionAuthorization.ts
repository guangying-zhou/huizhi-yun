import { createHash } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import {
  deriveRoleCatalogCategory,
  isRoleCatalogMetadataMissingTableError
} from './roleCatalogCategory.ts'

export interface PeoplePositionAuthorizationExecutor {
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
  queryRows: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<T>
  execute: <T extends ResultSetHeader>(sql: string, params?: unknown[]) => Promise<T>
}

export interface SyncPeoplePositionAuthorizationInput {
  tenantCode: string
  uid: string
  sourceApp: string
  positionCode?: string | null
  positionName?: string | null
  deptCode?: string | null
  operatorUid?: string | null
  reason?: string | null
  idempotencyKey?: string | null
}

interface SubjectRow extends RowDataPacket {
  id: number
  tenant_code: string
  subject_type: string
  subject_code: string
  external_ref: string | null
  status: string
}

interface RoleRow extends RowDataPacket {
  id: number
  tenant_code: string
  role_code: string
  role_name: string
  description: string | null
  source: string
  source_role_code: string | null
  catalog_category: string | null
}

interface AssignmentRow extends RowDataPacket {
  id: number
}

function text(value: unknown) {
  return String(value || '').trim()
}

function affectedRows(result: ResultSetHeader) {
  return Number(result.affectedRows || 0)
}

function requireNormalized(value: unknown, field: string) {
  const normalized = text(value)
  if (!normalized) {
    throw new Error(`${field} is required`)
  }
  return normalized
}

function unique(values: string[]) {
  return Array.from(new Set(values.map(item => item.trim()).filter(Boolean)))
}

function normalizedRoleCodeCandidates(positionCode: string) {
  if (!positionCode) return []

  const lower = positionCode.toLowerCase()
  const underscore = lower.replace(/-/g, '_')
  const hyphen = lower.replace(/_/g, '-')

  return unique([
    positionCode,
    lower,
    underscore,
    hyphen,
    `job:${lower}`,
    `job:${underscore}`,
    `position:${lower}`,
    `position:${underscore}`,
    `people:position:${lower}`,
    `people:position:${underscore}`
  ])
}

function sourceIdForPosition(positionCode: string, positionName: string) {
  const stablePart = positionCode || positionName
  if (!stablePart) return null

  const prefix = positionCode ? 'people:position:' : 'people:position-name:'
  const raw = `${prefix}${stablePart}`
  if (raw.length <= 128) return raw

  const hash = createHash('sha256').update(stablePart).digest('hex').slice(0, 24)
  return `${prefix}sha256:${hash}`
}

async function ensureUserSubject(
  executor: PeoplePositionAuthorizationExecutor,
  tenantCode: string,
  uid: string
) {
  const existing = await executor.queryRow<SubjectRow>(
    `SELECT id, tenant_code, subject_type, subject_code, external_ref, status
       FROM tenant_subjects
      WHERE tenant_code = ?
        AND subject_type = 'user'
        AND (subject_code = ? OR external_ref = ?)
      LIMIT 1`,
    [tenantCode, uid, uid]
  )

  if (existing) {
    if (existing.status !== 'active' || !existing.external_ref) {
      await executor.execute<ResultSetHeader>(
        `UPDATE tenant_subjects
            SET status = 'active',
                external_ref = COALESCE(external_ref, ?),
                updated_at = UTC_TIMESTAMP()
          WHERE tenant_code = ?
            AND id = ?`,
        [uid, tenantCode, existing.id]
      )
    }

    return {
      subject: { ...existing, status: 'active' },
      created: false,
      reactivated: existing.status !== 'active'
    }
  }

  const inserted = await executor.execute<ResultSetHeader>(
    `INSERT INTO tenant_subjects
      (tenant_code, subject_type, subject_code, display_name, external_ref, status, created_at, updated_at)
     VALUES (?, 'user', ?, NULL, ?, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [tenantCode, uid, uid]
  )

  return {
    subject: {
      id: Number(inserted.insertId || 0),
      tenant_code: tenantCode,
      subject_type: 'user',
      subject_code: uid,
      external_ref: uid,
      status: 'active'
    } as SubjectRow,
    created: true,
    reactivated: false
  }
}

async function loadCandidateRoles(
  executor: PeoplePositionAuthorizationExecutor,
  tenantCode: string,
  positionCode: string,
  positionName: string,
  includeMetadata: boolean
) {
  const codeCandidates = normalizedRoleCodeCandidates(positionCode)
  const conditions: string[] = []
  const params: unknown[] = [tenantCode]

  if (codeCandidates.length > 0) {
    const placeholders = codeCandidates.map(() => '?').join(', ')
    conditions.push(`(tr.role_code IN (${placeholders}) OR tr.source_role_code IN (${placeholders}))`)
    params.push(...codeCandidates, ...codeCandidates)
  }
  if (positionName) {
    conditions.push('tr.role_name = ?')
    params.push(positionName)
  }
  if (conditions.length === 0) return []

  const metadataColumn = includeMetadata ? 'trcm.category AS catalog_category' : 'NULL AS catalog_category'
  const metadataJoin = includeMetadata
    ? `LEFT JOIN tenant_role_catalog_metadata trcm
         ON trcm.tenant_code = tr.tenant_code
        AND trcm.role_id = tr.id`
    : ''

  return executor.queryRows<RoleRow[]>(
    `SELECT tr.id, tr.tenant_code, tr.role_code, tr.role_name, tr.description,
            tr.source, tr.source_role_code, ${metadataColumn}
       FROM tenant_roles tr
       ${metadataJoin}
      WHERE tr.tenant_code = ?
        AND tr.app_code IS NULL
        AND tr.status = 'active'
        AND tr.is_assignable = 1
        AND (${conditions.join(' OR ')})
      ORDER BY tr.role_code ASC
      LIMIT 50`,
    params
  )
}

async function selectMainPositionRole(
  executor: PeoplePositionAuthorizationExecutor,
  tenantCode: string,
  positionCode: string,
  positionName: string
) {
  let metadataAvailable = true
  let rows: RoleRow[]

  try {
    rows = await loadCandidateRoles(executor, tenantCode, positionCode, positionName, true)
  } catch (error) {
    if (!isRoleCatalogMetadataMissingTableError(error)) throw error
    metadataAvailable = false
    rows = await loadCandidateRoles(executor, tenantCode, positionCode, positionName, false)
  }

  const codeCandidates = new Set(normalizedRoleCodeCandidates(positionCode).map(item => item.toLowerCase()))
  const evaluated = rows
    .map((row) => {
      const roleCode = text(row.role_code).toLowerCase()
      const sourceRoleCode = text(row.source_role_code).toLowerCase()
      const exactCodeMatch = codeCandidates.has(roleCode) || codeCandidates.has(sourceRoleCode)
      const exactNameMatch = positionName && text(row.role_name) === positionName
      const category = deriveRoleCatalogCategory({
        roleCode: row.role_code,
        roleName: row.role_name,
        description: row.description,
        source: row.source,
        catalogCategory: row.catalog_category
      })
      // 岗位同步只能自动授予主岗位角色。高风险、审批职责、管理职责和自定义角色
      // 即使岗位编码精确命中也不得自动授予，必须由显式授权或人工归类为主岗位后生效。
      const usableAsMainPosition = category.category === 'main_position'

      return {
        row,
        category,
        exactCodeMatch,
        exactNameMatch,
        usableAsMainPosition,
        score: (exactCodeMatch ? 0 : exactNameMatch ? 10 : 50)
          + (category.source === 'manual' ? 0 : 5)
      }
    })

  // 被闸门排除的候选必须可解释，否则管理员只看到“没有匹配角色”，
  // 无法区分“租户确实没配岗位角色”和“角色因归类为敏感职责被拦下”。
  const excludedCandidates = evaluated
    .filter(item => !item.usableAsMainPosition)
    .map(item => ({
      roleCode: text(item.row.role_code),
      roleName: text(item.row.role_name),
      category: item.category.category,
      categorySource: item.category.source,
      exactCodeMatch: item.exactCodeMatch,
      exactNameMatch: Boolean(item.exactNameMatch)
    }))

  const scored = evaluated
    .filter(item => item.usableAsMainPosition)
    .sort((a, b) => a.score - b.score || a.row.role_code.localeCompare(b.row.role_code))

  const selected = scored[0]
  if (!selected) {
    return {
      role: null,
      metadataAvailable,
      candidateCount: rows.length,
      excludedCandidates
    }
  }

  return {
    role: selected.row,
    metadataAvailable,
    candidateCount: rows.length,
    category: selected.category,
    excludedCandidates
  }
}

async function revokePreviousPeoplePositionAssignments(
  executor: PeoplePositionAuthorizationExecutor,
  tenantCode: string,
  subjectId: number,
  retainedRoleId: number | null,
  retainedSourceId: string | null
) {
  const params: unknown[] = [tenantCode, subjectId]
  const retainSql = retainedRoleId && retainedSourceId
    ? 'AND NOT (role_id = ? AND source_id = ?)'
    : ''
  if (retainedRoleId && retainedSourceId) {
    params.push(retainedRoleId, retainedSourceId)
  }

  const result = await executor.execute<ResultSetHeader>(
    `UPDATE tenant_subject_roles
        SET status = 'revoked',
            expired_at = COALESCE(expired_at, UTC_TIMESTAMP())
      WHERE tenant_code = ?
        AND subject_id = ?
        AND source_type = 'system'
        AND assignment_kind = 'position'
        AND source_id LIKE 'people:position%'
        AND status <> 'revoked'
        ${retainSql}`,
    params
  )

  return affectedRows(result)
}

async function upsertPositionAssignment(input: {
  executor: PeoplePositionAuthorizationExecutor
  tenantCode: string
  subjectId: number
  roleId: number
  sourceId: string
  reason: string
  operatorUid: string | null
}) {
  const { executor, tenantCode, subjectId, roleId, sourceId, reason, operatorUid } = input

  await executor.execute<ResultSetHeader>(
    `INSERT INTO tenant_subject_roles
      (tenant_code, subject_id, role_id, source_type, assignment_kind, source_id, reason, granted_by_uid, granted_at, starts_at, expired_at, status)
     VALUES (?, ?, ?, 'system', 'position', ?, ?, ?, UTC_TIMESTAMP(), NULL, NULL, 'active')
     ON DUPLICATE KEY UPDATE
       assignment_kind = 'position',
       reason = VALUES(reason),
       granted_by_uid = VALUES(granted_by_uid),
       granted_at = VALUES(granted_at),
       starts_at = NULL,
       expired_at = NULL,
       status = 'active'`,
    [tenantCode, subjectId, roleId, sourceId, reason, operatorUid]
  )

  const row = await executor.queryRow<AssignmentRow>(
    `SELECT id
       FROM tenant_subject_roles
      WHERE tenant_code = ?
        AND subject_id = ?
        AND role_id = ?
        AND source_type = 'system'
        AND source_id_key = IFNULL(?, '__NULL__')
      LIMIT 1`,
    [tenantCode, subjectId, roleId, sourceId]
  )

  return Number(row?.id || 0)
}

async function writeLifecycleAudit(
  executor: PeoplePositionAuthorizationExecutor,
  input: SyncPeoplePositionAuthorizationInput,
  before: Record<string, unknown>,
  after: Record<string, unknown>
) {
  await executor.execute<ResultSetHeader>(
    `INSERT INTO tenant_audit_logs
      (tenant_code, operator_uid, target_type, target_id, action, before_json, after_json, source, created_at)
     VALUES (?, ?, 'user', ?, 'authorization.user.position.sync.from_people', CAST(? AS JSON), CAST(? AS JSON), ?, UTC_TIMESTAMP())`,
    [
      input.tenantCode,
      text(input.operatorUid) || null,
      input.uid,
      JSON.stringify(before),
      JSON.stringify(after),
      'people'
    ]
  )
}

export async function syncPeoplePositionAuthorization(
  executor: PeoplePositionAuthorizationExecutor,
  input: SyncPeoplePositionAuthorizationInput
) {
  const tenantCode = requireNormalized(input.tenantCode, 'tenantCode')
  const uid = requireNormalized(input.uid, 'uid')
  const sourceApp = text(input.sourceApp)
  const positionCode = text(input.positionCode)
  const positionName = text(input.positionName)
  const sourceId = sourceIdForPosition(positionCode, positionName)
  const reason = text(input.reason) || 'people_employment_position_sync'
  const operatorUid = text(input.operatorUid) || null

  if (sourceApp !== 'people') {
    throw new Error('Only People lifecycle facts may trigger user position authorization sync.')
  }

  const { subject, created, reactivated } = await ensureUserSubject(executor, tenantCode, uid)
  const selected = await selectMainPositionRole(executor, tenantCode, positionCode, positionName)
  const role = selected.role
  const retainedSourceId = role && sourceId ? sourceId : null
  const revokedPositionAssignments = await revokePreviousPeoplePositionAssignments(
    executor,
    tenantCode,
    subject.id,
    role?.id || null,
    retainedSourceId
  )
  const grantedAssignmentId = role && retainedSourceId
    ? await upsertPositionAssignment({
        executor,
        tenantCode,
        subjectId: subject.id,
        roleId: role.id,
        sourceId: retainedSourceId,
        reason,
        operatorUid
      })
    : 0

  const result = {
    tenantCode,
    uid,
    subjectId: subject.id,
    subjectCreated: created,
    subjectReactivated: reactivated,
    positionCode: positionCode || null,
    positionName: positionName || null,
    roleMatched: Boolean(role),
    role: role
      ? {
          id: role.id,
          roleCode: role.role_code,
          roleName: role.role_name,
          catalogCategory: selected.category?.category || null,
          catalogCategorySource: selected.category?.source || null
        }
      : null,
    sourceId: retainedSourceId,
    grantedAssignmentId,
    revokedPositionAssignments,
    metadataAvailable: selected.metadataAvailable,
    candidateCount: selected.candidateCount,
    excludedCandidates: selected.excludedCandidates,
    idempotencyKey: text(input.idempotencyKey) || null
  }

  await writeLifecycleAudit(
    executor,
    { ...input, tenantCode, uid },
    {
      sourceApp,
      reason,
      positionCode: positionCode || null,
      positionName: positionName || null
    },
    result
  )

  return result
}
