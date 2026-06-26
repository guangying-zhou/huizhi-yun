import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow, queryRows, withTransaction } from '~~/server/utils/db'
import { runDirectoryProviderSync } from '~~/server/utils/directoryProviderRunners'

export type DirectorySyncProvider = 'console' | 'manual' | 'account' | 'ldap' | 'wecom' | 'dingtalk' | 'gitlab'
export type DirectorySyncScope = 'all' | 'users' | 'departments' | 'projects' | 'identities' | 'subjects'
export type DirectorySyncType = 'full' | 'incremental' | 'manual' | 'shadow_check'

interface SyncJobRow extends RowDataPacket {
  job_code: string
  provider_code: string
  sync_type: string
  object_scope: string
  cursor_before: string | null
  cursor_after: string | null
  status: string
  started_at: string | null
  finished_at: string | null
  requested_by: string | null
  total_count: number
  created_count: number
  updated_count: number
  deleted_count: number
  skipped_count: number
  error_count: number
  error_message: string | null
  created_at: string
  updated_at: string
}

interface CountRow extends RowDataPacket {
  count: number
}

interface SyncEventRow extends RowDataPacket {
  id: number
  job_code: string
  object_type: string
  object_code: string
  change_type: string
  source_provider: string
  external_ref: string | null
  status: string
  message: string | null
  before_hash: string | null
  after_hash: string | null
  created_at: string
}

export interface StartDirectorySyncInput {
  providerCode?: DirectorySyncProvider
  syncType?: DirectorySyncType
  objectScope?: DirectorySyncScope
  requestedBy?: string | null
  event?: H3Event
}

function normalizeProvider(value: unknown): DirectorySyncProvider {
  const provider = String(value || 'console').trim() as DirectorySyncProvider
  if (['console', 'manual', 'account', 'ldap', 'wecom', 'dingtalk', 'gitlab'].includes(provider)) return provider
  throw createError({ statusCode: 400, message: 'Unsupported providerCode' })
}

function normalizeScope(value: unknown): DirectorySyncScope {
  const scope = String(value || 'subjects').trim() as DirectorySyncScope
  if (['all', 'users', 'departments', 'projects', 'identities', 'subjects'].includes(scope)) return scope
  throw createError({ statusCode: 400, message: 'Unsupported objectScope' })
}

function normalizeSyncType(value: unknown): DirectorySyncType {
  const syncType = String(value || 'manual').trim() as DirectorySyncType
  if (['full', 'incremental', 'manual', 'shadow_check'].includes(syncType)) return syncType
  throw createError({ statusCode: 400, message: 'Unsupported syncType' })
}

function createJobCode(providerCode: string, objectScope: string) {
  const random = Math.random().toString(36).slice(2, 8)
  const now = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  return `${providerCode}-${objectScope}-${now}-${random}`
}

function mapJob(row: SyncJobRow) {
  return {
    jobCode: row.job_code,
    providerCode: row.provider_code,
    syncType: row.sync_type,
    objectScope: row.object_scope,
    cursorBefore: row.cursor_before,
    cursorAfter: row.cursor_after,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    requestedBy: row.requested_by,
    totalCount: Number(row.total_count || 0),
    createdCount: Number(row.created_count || 0),
    updatedCount: Number(row.updated_count || 0),
    deletedCount: Number(row.deleted_count || 0),
    skippedCount: Number(row.skipped_count || 0),
    errorCount: Number(row.error_count || 0),
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapEvent(row: SyncEventRow) {
  return {
    id: row.id,
    jobCode: row.job_code,
    objectType: row.object_type,
    objectCode: row.object_code,
    changeType: row.change_type,
    sourceProvider: row.source_provider,
    externalRef: row.external_ref,
    status: row.status,
    message: row.message,
    beforeHash: row.before_hash,
    afterHash: row.after_hash,
    createdAt: row.created_at
  }
}

export async function listDirectorySyncJobs(limit = 20) {
  const rows = await queryRows<SyncJobRow[]>(
    `SELECT *
       FROM directory_sync_jobs
      ORDER BY created_at DESC
      LIMIT ?`,
    [Math.min(Math.max(Number(limit) || 20, 1), 100)]
  )

  return rows.map(mapJob)
}

export async function getDirectorySyncJob(jobCode: string) {
  const row = await queryRow<SyncJobRow>(
    'SELECT * FROM directory_sync_jobs WHERE job_code = ? LIMIT 1',
    [jobCode]
  )

  return row ? mapJob(row) : null
}

export async function listDirectorySyncEvents(jobCode: string, limit = 100) {
  const rows = await queryRows<SyncEventRow[]>(
    `SELECT *
       FROM directory_sync_events
      WHERE job_code = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    [jobCode, Math.min(Math.max(Number(limit) || 100, 1), 500)]
  )

  return rows.map(mapEvent)
}

async function insertSyncEvent(input: {
  jobCode: string
  objectType: string
  objectCode: string
  changeType: string
  sourceProvider: string
  externalRef?: string | null
  status: 'success' | 'skipped' | 'failed'
  message?: string | null
}) {
  await execute<ResultSetHeader>(
    `INSERT INTO directory_sync_events (
      job_code,
      object_type,
      object_code,
      change_type,
      source_provider,
      external_ref,
      status,
      message,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      input.jobCode,
      input.objectType,
      input.objectCode,
      input.changeType,
      input.sourceProvider,
      input.externalRef || null,
      input.status,
      input.message || null
    ]
  )
}

async function countSubjectExports() {
  const row = await queryRow<CountRow>('SELECT COUNT(*) AS count FROM directory_subject_exports')
  return Number(row?.count || 0)
}

async function rebuildSubjectExports() {
  const beforeCount = await countSubjectExports()

  await withTransaction(async (tx) => {
    await tx.execute<ResultSetHeader>(
      `INSERT INTO directory_subject_exports (
        subject_type,
        subject_code,
        external_ref,
        parent_subject_type,
        parent_subject_code,
        source_object_type,
        source_object_code,
        snapshot_hash,
        status,
        exported_at,
        created_at,
        updated_at
      )
      SELECT
        CASE WHEN dd.org_type = 'committee' THEN 'committee' ELSE 'department' END,
        dd.dept_code,
        SHA2(CONCAT('console:', CASE WHEN dd.org_type = 'committee' THEN 'committee' ELSE 'department' END, ':', dd.dept_code), 256),
        CASE
          WHEN dd.parent_dept_code IS NULL THEN NULL
          WHEN parent.org_type = 'committee' THEN 'committee'
          ELSE 'department'
        END,
        dd.parent_dept_code,
        'directory_departments',
        dd.dept_code,
        SHA2(CONCAT_WS('|', CASE WHEN dd.org_type = 'committee' THEN 'committee' ELSE 'department' END, dd.dept_code, COALESCE(dd.parent_dept_code, ''), dd.status), 256),
        dd.status,
        NOW(),
        NOW(),
        NOW()
      FROM directory_departments dd
      LEFT JOIN directory_departments parent
        ON parent.dept_code = dd.parent_dept_code
      ON DUPLICATE KEY UPDATE
        external_ref = VALUES(external_ref),
        parent_subject_type = VALUES(parent_subject_type),
        parent_subject_code = VALUES(parent_subject_code),
        snapshot_hash = VALUES(snapshot_hash),
        status = VALUES(status),
        exported_at = VALUES(exported_at),
        updated_at = VALUES(updated_at)`
    )

    await tx.execute<ResultSetHeader>(
      `UPDATE directory_subject_exports dse
       INNER JOIN directory_departments dd
          ON dd.dept_code = dse.subject_code
       SET dse.status = 'inactive',
           dse.snapshot_hash = SHA2(CONCAT_WS('|', 'department', dd.dept_code, COALESCE(dd.parent_dept_code, ''), 'inactive'), 256),
           dse.exported_at = NOW(),
           dse.updated_at = NOW()
       WHERE dse.subject_type = 'department'
         AND dd.org_type = 'committee'`
    )

    await tx.execute<ResultSetHeader>(
      `INSERT INTO directory_subject_exports (
        subject_type,
        subject_code,
        external_ref,
        parent_subject_type,
        parent_subject_code,
        source_object_type,
        source_object_code,
        snapshot_hash,
        status,
        exported_at,
        created_at,
        updated_at
      )
      SELECT
        'user',
        u.uid,
        SHA2(CONCAT('console:user:', u.uid), 256),
        CASE WHEN pd.dept_code IS NULL THEN NULL ELSE 'department' END,
        pd.dept_code,
        'directory_users',
        u.uid,
        SHA2(CONCAT_WS('|', 'user', u.uid, COALESCE(pd.dept_code, ''), u.status), 256),
        CASE WHEN u.status = 'pending' THEN 'inactive' ELSE u.status END,
        NOW(),
        NOW(),
        NOW()
      FROM directory_users u
      LEFT JOIN (
        SELECT ranked.uid, ranked.dept_code
        FROM (
          SELECT ud.uid,
                 ud.dept_code,
                 ROW_NUMBER() OVER (
                   PARTITION BY ud.uid
                   ORDER BY ud.is_primary DESC, d.sort_order ASC, d.id ASC, ud.id ASC
                 ) AS row_no
            FROM directory_user_departments ud
            INNER JOIN directory_departments d ON d.dept_code = ud.dept_code
           WHERE ud.status = 'active'
             AND ud.relation_type = 'member'
             AND d.status = 'active'
             AND d.org_type = 'department'
        ) ranked
        WHERE ranked.row_no = 1
      ) pd ON pd.uid = u.uid
      ON DUPLICATE KEY UPDATE
        external_ref = VALUES(external_ref),
        parent_subject_type = VALUES(parent_subject_type),
        parent_subject_code = VALUES(parent_subject_code),
        snapshot_hash = VALUES(snapshot_hash),
        status = VALUES(status),
        exported_at = VALUES(exported_at),
        updated_at = VALUES(updated_at)`
    )

    await tx.execute<ResultSetHeader>(
      `INSERT INTO directory_subject_exports (
        subject_type,
        subject_code,
        external_ref,
        parent_subject_type,
        parent_subject_code,
        source_object_type,
        source_object_code,
        snapshot_hash,
        status,
        exported_at,
        created_at,
        updated_at
      )
      SELECT
        'project',
        project_code,
        SHA2(CONCAT('console:project:', project_code), 256),
        CASE
          WHEN parent_project_code IS NOT NULL THEN 'project'
          WHEN dept_code IS NOT NULL THEN 'department'
          ELSE NULL
        END,
        COALESCE(parent_project_code, dept_code),
        'directory_projects',
        project_code,
        SHA2(CONCAT_WS('|', 'project', project_code, COALESCE(parent_project_code, ''), COALESCE(dept_code, ''), status), 256),
        CASE WHEN status = 'archived' THEN 'inactive' ELSE status END,
        NOW(),
        NOW(),
        NOW()
      FROM directory_projects
      ON DUPLICATE KEY UPDATE
        external_ref = VALUES(external_ref),
        parent_subject_type = VALUES(parent_subject_type),
        parent_subject_code = VALUES(parent_subject_code),
        snapshot_hash = VALUES(snapshot_hash),
        status = VALUES(status),
        exported_at = VALUES(exported_at),
        updated_at = VALUES(updated_at)`
    )

    await tx.execute<ResultSetHeader>(
      `UPDATE directory_subject_exports dse
       LEFT JOIN directory_users u
         ON u.uid = dse.source_object_code
       SET dse.status = 'inactive',
           dse.snapshot_hash = SHA2(CONCAT_WS('|', dse.subject_type, dse.subject_code, COALESCE(dse.parent_subject_type, ''), COALESCE(dse.parent_subject_code, ''), 'inactive'), 256),
           dse.exported_at = NOW(),
           dse.updated_at = NOW()
       WHERE dse.source_object_type = 'directory_users'
         AND dse.subject_type = 'user'
         AND u.uid IS NULL
         AND dse.status = 'active'`
    )

    await tx.execute<ResultSetHeader>(
      `UPDATE directory_subject_exports dse
       LEFT JOIN directory_departments dd
         ON dd.dept_code = dse.source_object_code
       SET dse.status = 'inactive',
           dse.snapshot_hash = SHA2(CONCAT_WS('|', dse.subject_type, dse.subject_code, COALESCE(dse.parent_subject_type, ''), COALESCE(dse.parent_subject_code, ''), 'inactive'), 256),
           dse.exported_at = NOW(),
           dse.updated_at = NOW()
       WHERE dse.source_object_type = 'directory_departments'
         AND dse.subject_type IN ('department', 'committee')
         AND dd.dept_code IS NULL
         AND dse.status = 'active'`
    )

    await tx.execute<ResultSetHeader>(
      `UPDATE directory_subject_exports dse
       LEFT JOIN directory_projects p
         ON p.project_code = dse.source_object_code
       SET dse.status = 'inactive',
           dse.snapshot_hash = SHA2(CONCAT_WS('|', dse.subject_type, dse.subject_code, COALESCE(dse.parent_subject_type, ''), COALESCE(dse.parent_subject_code, ''), 'inactive'), 256),
           dse.exported_at = NOW(),
           dse.updated_at = NOW()
       WHERE dse.source_object_type = 'directory_projects'
         AND dse.subject_type = 'project'
         AND p.project_code IS NULL
         AND dse.status = 'active'`
    )
  })

  const afterCount = await countSubjectExports()
  return {
    beforeCount,
    afterCount,
    changedCount: Math.max(afterCount - beforeCount, 0)
  }
}

export async function startDirectorySyncJob(input: StartDirectorySyncInput) {
  const providerCode = normalizeProvider(input.providerCode)
  const objectScope = normalizeScope(input.objectScope)
  const syncType = normalizeSyncType(input.syncType)
  const requestedBy = input.requestedBy || 'console'
  const jobCode = createJobCode(providerCode, objectScope)

  await execute<ResultSetHeader>(
    `INSERT INTO directory_sync_jobs (
      job_code,
      provider_code,
      sync_type,
      object_scope,
      status,
      requested_by,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, NOW(), NOW())`,
    [jobCode, providerCode, syncType, objectScope, requestedBy]
  )

  try {
    await execute<ResultSetHeader>(
      `UPDATE directory_sync_jobs
          SET status = 'running', started_at = NOW(), updated_at = NOW()
        WHERE job_code = ?`,
      [jobCode]
    )

    if ((providerCode === 'console' || providerCode === 'manual') && (objectScope === 'subjects' || objectScope === 'all')) {
      const result = await rebuildSubjectExports()

      await execute<ResultSetHeader>(
        `INSERT INTO directory_sync_events (
          job_code,
          object_type,
          object_code,
          change_type,
          source_provider,
          external_ref,
          status,
          message,
          created_at
        ) VALUES (?, 'summary', '__subject_exports__', 'update', ?, ?, 'success', ?, NOW())`,
        [jobCode, providerCode, `console:${objectScope}`, `Rebuilt subject exports. before=${result.beforeCount}, after=${result.afterCount}`]
      )

      await execute<ResultSetHeader>(
        `UPDATE directory_sync_jobs
            SET status = 'success',
                finished_at = NOW(),
                total_count = ?,
                created_count = ?,
                updated_count = ?,
                error_count = 0,
                updated_at = NOW()
          WHERE job_code = ?`,
        [result.afterCount, result.changedCount, result.afterCount, jobCode]
      )
    } else if (['account', 'ldap', 'wecom', 'dingtalk', 'gitlab'].includes(providerCode)) {
      const result = await runDirectoryProviderSync({
        jobCode,
        providerCode: providerCode as 'account' | 'ldap' | 'wecom' | 'dingtalk' | 'gitlab',
        objectScope,
        event: input.event
      })

      if (objectScope !== 'identities') {
        await rebuildSubjectExports()
      }

      await execute<ResultSetHeader>(
        `UPDATE directory_sync_jobs
            SET status = ?,
                integration_id = ?,
                finished_at = NOW(),
                total_count = ?,
                created_count = ?,
                updated_count = ?,
                deleted_count = ?,
                skipped_count = ?,
                error_count = ?,
                error_message = ?,
                updated_at = NOW()
          WHERE job_code = ?`,
        [
          result.errorCount > 0 ? 'partial_success' : 'success',
          result.integrationId,
          result.totalCount,
          result.createdCount,
          result.updatedCount,
          result.deletedCount,
          result.skippedCount,
          result.errorCount,
          result.errorCount > 0 ? result.message : null,
          jobCode
        ]
      )
    } else {
      throw createError({
        statusCode: 501,
        message: `Provider ${providerCode}/${objectScope} is not implemented in Console yet`
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Directory sync failed'
    await insertSyncEvent({
      jobCode,
      objectType: 'summary',
      objectCode: '__sync_failed__',
      changeType: 'error',
      sourceProvider: providerCode,
      externalRef: `console:${providerCode}:${objectScope}`,
      status: 'failed',
      message
    })
    await execute<ResultSetHeader>(
      `UPDATE directory_sync_jobs
          SET status = 'failed',
              finished_at = NOW(),
              error_count = 1,
              error_message = ?,
              updated_at = NOW()
        WHERE job_code = ?`,
      [message, jobCode]
    )
    throw error
  }

  return await getDirectorySyncJob(jobCode)
}
