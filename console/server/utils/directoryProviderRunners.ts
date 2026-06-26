import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow, queryRows, withTransaction } from '~~/server/utils/db'
import type { DirectorySourceProvider } from '~~/server/utils/directorySources'
import { getDirectorySourceRuntimeConfig } from '~~/server/utils/directorySources'
import type { DirectorySyncScope } from '~~/server/utils/directorySyncJobs'
import { getIntegration } from '~~/server/utils/integrations'
import { resolveVaultSecret } from '~~/server/utils/vault'

type DirectoryProviderRunnerCode = DirectorySourceProvider | 'account' | 'gitlab'

interface RunnerInput {
  jobCode: string
  providerCode: DirectoryProviderRunnerCode
  objectScope: DirectorySyncScope
  event?: H3Event
}

interface RunnerResult {
  providerCode: DirectoryProviderRunnerCode
  integrationId: number | null
  totalCount: number
  createdCount: number
  updatedCount: number
  deletedCount: number
  skippedCount: number
  errorCount: number
  message: string
}

interface ExistingUidRow extends RowDataPacket {
  uid: string
}

interface ExistingCountRow extends RowDataPacket {
  count: number
}

interface DepartmentMembershipCandidateRow extends RowDataPacket {
  id: number
  uid: string
}

interface LdapUser {
  dn: string
  uid: string
  cn: string | null
  sn: string | null
  mail: string | null
  telephoneNumber: string | null
}

type LdapSearchEntry = {
  dn: {
    toString: () => string
  }
  pojo?: {
    attributes?: Array<{
      type: string
      values?: string[]
    }>
  }
}

type LdapSearchResponse = {
  on: {
    (event: 'searchEntry', handler: (entry: LdapSearchEntry) => void): void
    (event: 'error', handler: (error: Error) => void): void
    (event: 'end', handler: () => void): void
  }
}

type LdapClient = {
  on: (event: 'error', handler: (error: Error) => void) => void
  bind: (dn: string, password: string, callback: (error: Error | null) => void) => void
  search: (base: string, options: Record<string, unknown>, callback: (error: Error | null, response: LdapSearchResponse) => void) => void
  unbind: () => void
}

type LdapModule = {
  default?: {
    createClient?: (options: Record<string, unknown>) => LdapClient
  }
  createClient?: (options: Record<string, unknown>) => LdapClient
}

interface WecomTokenResponse {
  errcode: number
  errmsg: string
  access_token?: string
  expires_in?: number
}

interface WecomDepartment {
  id: number
  name: string
  parentid: number
  order?: number
}

interface WecomDepartmentResponse {
  errcode: number
  errmsg: string
  department?: WecomDepartment[]
}

interface WecomUser {
  userid: string
  name?: string
  mobile?: string
  email?: string
  biz_mail?: string
  avatar?: string
  department?: number[]
  status?: number
  position?: string
}

interface WecomUserListResponse {
  errcode: number
  errmsg: string
  userlist?: WecomUser[]
}

interface DingTalkTokenResponse {
  accessToken?: string
  expireIn?: number
}

interface DingTalkDepartment {
  dept_id: number
  name: string
  parent_id: number
}

interface DingTalkDepartmentResponse {
  errcode: number
  errmsg: string
  result?: DingTalkDepartment[]
}

interface DingTalkUser {
  userid: string
  name?: string
  avatar?: string
  mobile?: string
  email?: string
  title?: string
  dept_id_list?: number[]
  active?: boolean
}

interface DingTalkUserListResponse {
  errcode: number
  errmsg: string
  result?: {
    list?: DingTalkUser[]
    has_more?: boolean
    next_cursor?: number
  }
}

interface GitLabGroup {
  id: number
  name: string
  path: string
  full_path: string
  parent_id: number | null
  description: string | null
  created_at?: string | null
}

interface GitLabProject {
  id: number
  name: string
  path: string
  path_with_namespace: string
  description: string | null
  created_at?: string | null
  archived?: boolean
  namespace?: {
    id: number
    name: string
    path: string
    full_path: string
    kind: string
  }
}

interface GitLabMember {
  id: number
  username: string
  access_level: number
}

interface DirectoryUserDeptRow extends RowDataPacket {
  uid: string
  dept_code: string | null
}

interface ExistingProjectRow extends RowDataPacket {
  project_code: string
}

interface AccountDepartmentRow extends RowDataPacket {
  id: number
  dept_code: string
  name: string
  parent_dept_code: string | null
  path: string | null
  level: number | null
  sort_order: number | null
  manager_uid: string | null
  leader_uid: string | null
  description: string | null
  org_type: string | null
  dept_category: number | null
  status: number | null
}

interface AccountUserRow extends RowDataPacket {
  id: number
  uid: string
  dept_code: string | null
  real_name: string | null
  nickname: string | null
  avatar: string | null
  mobile: string | null
  email: string | null
  position: string | null
  gender: number | null
  timezone: string | null
  language: string | null
  wecom_id: string | null
  dingtalk_id: string | null
  last_login_at: string | null
  last_login_ip: string | null
  user_type: number | null
  status: number | null
  remark: string | null
}

interface AccountUserDepartmentRow extends RowDataPacket {
  uid: string
  dept_code: string
}

interface AccountProjectRow extends RowDataPacket {
  id: number
  project_code: string
  parent_code: string | null
  name: string
  dept_code: string | null
  leader_uid: string | null
  description: string | null
  repo_url: string | null
  is_group: number | null
  is_template: number | null
  status: number | null
  created_at: string | null
}

interface AccountProjectMemberRow extends RowDataPacket {
  project_code: string
  uid: string
  role: string | null
}

async function directoryUserExists(uid: string) {
  const row = await queryRow<ExistingCountRow>(
    'SELECT COUNT(*) AS count FROM directory_users WHERE uid = ?',
    [uid]
  )
  return Number(row?.count || 0) > 0
}

function hashPayload(payload: unknown) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function isCloudflareRuntime() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.HZY_CLOUDFLARE_RUNTIME || process.env.HZY_CLOUDFLARE_BUILD || '').toLowerCase())
}

async function importOptionalModule<T>(specifier: string): Promise<T> {
  return (Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<T>)(specifier)
}

function stringConfig(config: Record<string, unknown>, key: string, fallback = '') {
  const value = config[key]
  return typeof value === 'string' ? value.trim() : fallback
}

function numberConfig(config: Record<string, unknown>, key: string, fallback: number) {
  const value = config[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) return Number(value)
  return fallback
}

function booleanConfig(config: Record<string, unknown>, key: string, fallback: boolean) {
  const value = config[key]
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true
    if (value.toLowerCase() === 'false') return false
  }
  return fallback
}

function normalizeEmail(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase()
}

function mobileTail4(value: string | null | undefined) {
  const text = String(value || '').trim()
  return text ? text.slice(-4) : null
}

function uidFromEmail(email: string) {
  const local = email.split('@')[0]?.trim().toLowerCase()
  return local || ''
}

function statusFromProvider(active: boolean) {
  return active ? 'active' : 'inactive'
}

function statusFromAccount(status: number | null | undefined): 'active' | 'inactive' | 'deleted' {
  if (status === -1) return 'deleted'
  return status === 0 ? 'inactive' : 'active'
}

function userTypeFromAccount(userType: number | null | undefined): 'system' | 'employee' | 'external' {
  if (userType === 0) return 'system'
  if (userType === 2) return 'external'
  return 'employee'
}

function genderFromAccount(gender: number | null | undefined): 'unknown' | 'male' | 'female' {
  if (gender === 1) return 'male'
  if (gender === 2) return 'female'
  return 'unknown'
}

function projectRoleFromAccount(role: string | null | undefined): 'owner' | 'admin' | 'member' | 'viewer' {
  if (role === 'owner' || role === 'admin' || role === 'viewer') return role
  return 'member'
}

function ensureScope(providerCode: DirectoryProviderRunnerCode, scope: DirectorySyncScope) {
  const supported = providerCode === 'ldap'
    ? ['all', 'users', 'identities']
    : providerCode === 'account'
      ? ['all', 'users', 'departments', 'projects', 'identities']
      : providerCode === 'gitlab'
        ? ['all', 'projects']
        : ['all', 'users', 'departments', 'identities']
  if (!supported.includes(scope)) {
    throw createError({ statusCode: 400, message: `${providerCode} provider does not support objectScope=${scope}` })
  }
}

async function insertSummaryEvent(jobCode: string, providerCode: DirectoryProviderRunnerCode, message: string) {
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
    ) VALUES (?, 'summary', ?, 'update', ?, ?, 'success', ?, NOW())`,
    [jobCode, `__${providerCode}_sync__`, providerCode, `console:${providerCode}`, message]
  )
}

async function findExistingUid(providerCode: DirectorySourceProvider, providerSubject: string, email: string | null) {
  const identity = await queryRow<ExistingUidRow>(
    'SELECT uid FROM directory_identities WHERE provider_code = ? AND provider_subject = ? LIMIT 1',
    [providerCode, providerSubject]
  )
  if (identity?.uid) return identity.uid

  if (email) {
    const user = await queryRow<ExistingUidRow>(
      'SELECT uid FROM directory_users WHERE LOWER(email) = ? LIMIT 1',
      [email.toLowerCase()]
    )
    if (user?.uid) return user.uid
  }

  const emailUid = email ? uidFromEmail(email) : ''
  return emailUid || providerSubject
}

async function sourceRowExists(table: 'directory_departments' | 'directory_users', providerCode: string, externalRef: string) {
  const row = await queryRow<ExistingCountRow>(
    `SELECT COUNT(*) AS count FROM ${table} WHERE source_provider = ? AND external_ref = ?`,
    [providerCode, externalRef]
  )
  return Number(row?.count || 0) > 0
}

async function upsertDepartment(input: {
  providerCode: string
  deptCode: string
  deptName: string
  parentDeptCode: string | null
  sortOrder?: number
  externalRef: string
  sourcePayload: unknown
  status?: 'active' | 'inactive' | 'deleted'
}) {
  const existed = await sourceRowExists('directory_departments', input.providerCode, input.externalRef)
  await execute<ResultSetHeader>(
    `INSERT INTO directory_departments (
      dept_code,
      dept_name,
      parent_dept_code,
      sort_order,
      source_provider,
      external_ref,
      source_payload_hash,
      synced_at,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      dept_name = VALUES(dept_name),
      parent_dept_code = VALUES(parent_dept_code),
      sort_order = VALUES(sort_order),
      source_provider = VALUES(source_provider),
      external_ref = VALUES(external_ref),
      source_payload_hash = VALUES(source_payload_hash),
      synced_at = VALUES(synced_at),
      status = VALUES(status),
      updated_at = NOW()`,
    [
      input.deptCode,
      input.deptName,
      input.parentDeptCode,
      input.sortOrder ?? 100,
      input.providerCode,
      input.externalRef,
      hashPayload(input.sourcePayload),
      input.status || 'active'
    ]
  )
  return existed ? 'updated' : 'created'
}

async function refreshDepartmentParents(providerCode: string) {
  await execute<ResultSetHeader>(
    `UPDATE directory_departments child
      LEFT JOIN directory_departments parent ON parent.dept_code = child.parent_dept_code
       SET child.parent_id = parent.id
     WHERE child.source_provider = ?`,
    [providerCode]
  )
}

async function upsertUser(input: {
  providerCode: string
  uid: string
  username: string
  displayName: string | null
  realName: string | null
  avatarUrl: string | null
  email: string | null
  mobile: string | null
  positionTitle: string | null
  primaryDeptCode: string | null
  externalRef: string
  sourcePayload: unknown
  status: 'active' | 'inactive' | 'pending' | 'deleted'
}) {
  const existed = await sourceRowExists('directory_users', input.providerCode, input.externalRef)
  await execute<ResultSetHeader>(
    `INSERT INTO directory_users (
      uid,
      username,
      display_name,
      real_name,
      avatar_url,
      email,
      mobile,
      mobile_tail4,
      position_title,
      primary_dept_code,
      user_type,
      source_provider,
      external_ref,
      source_payload_hash,
      synced_at,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'employee', ?, ?, ?, NOW(), ?, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      username = VALUES(username),
      display_name = VALUES(display_name),
      real_name = VALUES(real_name),
      avatar_url = VALUES(avatar_url),
      email = VALUES(email),
      mobile = VALUES(mobile),
      mobile_tail4 = VALUES(mobile_tail4),
      position_title = VALUES(position_title),
      primary_dept_code = VALUES(primary_dept_code),
      user_type = VALUES(user_type),
      source_provider = VALUES(source_provider),
      external_ref = VALUES(external_ref),
      source_payload_hash = VALUES(source_payload_hash),
      synced_at = VALUES(synced_at),
      status = VALUES(status),
      updated_at = NOW()`,
    [
      input.uid,
      input.username,
      input.displayName,
      input.realName,
      input.avatarUrl,
      input.email,
      input.mobile,
      mobileTail4(input.mobile),
      input.positionTitle,
      input.primaryDeptCode,
      input.providerCode,
      input.externalRef,
      hashPayload(input.sourcePayload),
      input.status
    ]
  )
  return existed ? 'updated' : 'created'
}

async function upsertIdentity(input: {
  providerCode: string
  uid: string
  providerSubject: string
  providerUsername: string | null
  providerDn?: string | null
  email: string | null
  mobile: string | null
  profile: Record<string, unknown>
  status: 'active' | 'inactive' | 'revoked' | 'deleted'
}) {
  await execute<ResultSetHeader>(
    `INSERT INTO directory_identities (
      uid,
      provider_code,
      provider_subject,
      provider_username,
      provider_dn,
      email,
      mobile_tail4,
      profile_json,
      last_synced_at,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      uid = VALUES(uid),
      provider_username = VALUES(provider_username),
      provider_dn = VALUES(provider_dn),
      email = VALUES(email),
      mobile_tail4 = VALUES(mobile_tail4),
      profile_json = VALUES(profile_json),
      last_synced_at = VALUES(last_synced_at),
      status = VALUES(status),
      updated_at = NOW()`,
    [
      input.uid,
      input.providerCode,
      input.providerSubject,
      input.providerUsername,
      input.providerDn || null,
      input.email,
      mobileTail4(input.mobile),
      JSON.stringify(input.profile),
      input.status
    ]
  )
}

async function markMissingProviderUsersDeleted(providerCode: string, externalRefs: string[]) {
  if (!externalRefs.length) return 0
  const placeholders = externalRefs.map(() => '?').join(',')
  const result = await execute<ResultSetHeader>(
    `UPDATE directory_users
        SET status = 'deleted', updated_at = NOW()
      WHERE source_provider = ?
        AND status <> 'deleted'
        AND external_ref NOT IN (${placeholders})`,
    [providerCode, ...externalRefs]
  )
  return result.affectedRows || 0
}

async function refreshUserPrimaryDepartments(providerCode: string) {
  await execute<ResultSetHeader>(
    `UPDATE directory_users u
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
        SET u.primary_dept_code = pd.dept_code,
            u.updated_at = NOW()
      WHERE u.source_provider = ?`,
    [providerCode]
  )
}

async function enforceSingleDepartmentMembership(providerCode: string) {
  const rows = await queryRows<DepartmentMembershipCandidateRow[]>(
    `SELECT ud.id, ud.uid
       FROM directory_user_departments ud
       INNER JOIN directory_departments d ON d.dept_code = ud.dept_code
      WHERE ud.source_provider = ?
        AND ud.status = 'active'
        AND ud.relation_type = 'member'
        AND d.status = 'active'
        AND d.org_type = 'department'
      ORDER BY ud.uid ASC, ud.is_primary DESC, d.sort_order ASC, d.id ASC, ud.id ASC`,
    [providerCode]
  )

  const seen = new Set<string>()
  const duplicateIds: number[] = []
  for (const row of rows) {
    if (seen.has(row.uid)) {
      duplicateIds.push(row.id)
    } else {
      seen.add(row.uid)
    }
  }

  if (duplicateIds.length > 0) {
    const placeholders = duplicateIds.map(() => '?').join(',')
    await execute<ResultSetHeader>(
      `UPDATE directory_user_departments
          SET is_primary = 0,
              status = 'inactive',
              left_at = COALESCE(left_at, NOW()),
              updated_at = NOW()
        WHERE id IN (${placeholders})`,
      duplicateIds
    )
  }
}

async function replaceUserDepartments(providerCode: string, memberships: Array<{ uid: string, deptCode: string, externalRef: string, isPrimary: boolean }>) {
  await withTransaction(async (tx) => {
    await tx.execute<ResultSetHeader>(
      `UPDATE directory_user_departments
          SET status = 'inactive', left_at = COALESCE(left_at, NOW()), updated_at = NOW()
        WHERE source_provider = ?`,
      [providerCode]
    )

    for (const membership of memberships) {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO directory_user_departments (
          uid,
          dept_code,
          relation_type,
          is_primary,
          source_provider,
          external_ref,
          joined_at,
          left_at,
          status,
          created_at,
          updated_at
        ) VALUES (?, ?, 'member', ?, ?, ?, NOW(), NULL, 'active', NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          is_primary = VALUES(is_primary),
          external_ref = VALUES(external_ref),
          left_at = NULL,
          status = 'active',
          updated_at = NOW()`,
        [membership.uid, membership.deptCode, membership.isPrimary ? 1 : 0, providerCode, membership.externalRef]
      )
    }
  })

  await enforceSingleDepartmentMembership(providerCode)
  await refreshUserPrimaryDepartments(providerCode)
}

async function upsertAccountDepartment(row: AccountDepartmentRow) {
  const existed = await sourceRowExists('directory_departments', 'account', `account:department:${row.id}`)
  await execute<ResultSetHeader>(
    `INSERT INTO directory_departments (
      dept_code, dept_name, parent_dept_code, dept_path, level_no, sort_order,
      manager_uid, leader_uid, org_type, dept_category, description, source_provider,
      external_ref, source_payload_hash, synced_at, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'account', ?, ?, NOW(), ?, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      dept_name = VALUES(dept_name),
      parent_dept_code = VALUES(parent_dept_code),
      dept_path = VALUES(dept_path),
      level_no = VALUES(level_no),
      sort_order = VALUES(sort_order),
      manager_uid = VALUES(manager_uid),
      leader_uid = VALUES(leader_uid),
      org_type = VALUES(org_type),
      dept_category = VALUES(dept_category),
      description = VALUES(description),
      source_provider = VALUES(source_provider),
      external_ref = VALUES(external_ref),
      source_payload_hash = VALUES(source_payload_hash),
      synced_at = VALUES(synced_at),
      status = VALUES(status),
      updated_at = NOW()`,
    [
      row.dept_code,
      row.name,
      row.parent_dept_code,
      row.path,
      row.level || 1,
      row.sort_order ?? 100,
      row.manager_uid,
      row.leader_uid,
      row.org_type || 'department',
      row.dept_category == null ? null : String(row.dept_category),
      row.description,
      `account:department:${row.id}`,
      hashPayload(row),
      statusFromAccount(row.status)
    ]
  )
  return existed ? 'updated' : 'created'
}

async function syncAccountDepartments() {
  const rows = await queryRows<AccountDepartmentRow[]>(
    `SELECT d.id, d.dept_code, d.name, p.dept_code AS parent_dept_code,
            d.path, d.level, d.sort_order, d.manager_uid, d.leader_uid,
            d.description, d.org_type, d.dept_category, d.status
       FROM departments d
       LEFT JOIN departments p ON p.id = d.parent_id
      ORDER BY d.level ASC, d.sort_order ASC, d.id ASC`
  )

  let created = 0
  let updated = 0
  for (const row of rows) {
    const result = await upsertAccountDepartment(row)
    if (result === 'created') created++
    else updated++
  }
  await refreshDepartmentParents('account')
  return { total: rows.length, created, updated }
}

async function syncAccountUsers(scope: DirectorySyncScope) {
  const rows = await queryRows<AccountUserRow[]>(
    `SELECT id, uid, dept_code, real_name, nickname, avatar, mobile, email, position,
            gender, timezone, language, wecom_id, dingtalk_id, last_login_at,
            last_login_ip, user_type, status, remark
       FROM system_users
      ORDER BY id ASC`
  )

  let created = 0
  let updated = 0
  let skipped = 0

  if (scope === 'all' || scope === 'users') {
    for (const row of rows) {
      const result = await upsertUser({
        providerCode: 'account',
        uid: row.uid,
        username: row.uid,
        displayName: row.real_name || row.nickname || row.uid,
        realName: row.real_name,
        avatarUrl: row.avatar,
        email: normalizeEmail(row.email),
        mobile: row.mobile,
        positionTitle: row.position,
        primaryDeptCode: row.dept_code,
        externalRef: `account:user:${row.id}`,
        sourcePayload: row,
        status: statusFromAccount(row.status)
      })
      await execute<ResultSetHeader>(
        `UPDATE directory_users
            SET nickname = ?,
                gender = ?,
                timezone = COALESCE(?, timezone),
                locale = COALESCE(?, locale),
                user_type = ?,
                last_login_at = ?,
                last_login_ip = ?,
                remark = ?,
                updated_at = NOW()
          WHERE uid = ?`,
        [
          row.nickname,
          genderFromAccount(row.gender),
          row.timezone,
          row.language,
          userTypeFromAccount(row.user_type),
          row.last_login_at,
          row.last_login_ip,
          row.remark,
          row.uid
        ]
      )
      if (result === 'created') created++
      else updated++
    }

    const memberships = await queryRows<AccountUserDepartmentRow[]>(
      `SELECT ud.uid, ud.dept_code
         FROM user_departments ud
         INNER JOIN directory_users u ON u.uid = ud.uid
         INNER JOIN directory_departments d ON d.dept_code = ud.dept_code
        ORDER BY ud.uid ASC, ud.id ASC`
    )
    await replaceUserDepartments('account', memberships.map(membership => ({
      uid: membership.uid,
      deptCode: membership.dept_code,
      externalRef: `account:user_department:${membership.uid}:${membership.dept_code}`,
      isPrimary: true
    })))
  }

  if (scope === 'all' || scope === 'identities') {
    for (const row of rows) {
      if (!await directoryUserExists(row.uid)) {
        skipped++
        continue
      }
      const status = statusFromAccount(row.status) === 'deleted' ? 'deleted' : statusFromAccount(row.status)
      await upsertIdentity({
        providerCode: 'account',
        uid: row.uid,
        providerSubject: row.uid,
        providerUsername: row.uid,
        email: normalizeEmail(row.email),
        mobile: row.mobile,
        profile: { source: 'account', userId: row.id },
        status
      })
      if (row.wecom_id) {
        await upsertIdentity({
          providerCode: 'wecom',
          uid: row.uid,
          providerSubject: row.wecom_id,
          providerUsername: row.wecom_id,
          email: normalizeEmail(row.email),
          mobile: row.mobile,
          profile: { source: 'account', accountUserId: row.id },
          status
        })
      }
      if (row.dingtalk_id) {
        await upsertIdentity({
          providerCode: 'dingtalk',
          uid: row.uid,
          providerSubject: row.dingtalk_id,
          providerUsername: row.dingtalk_id,
          email: normalizeEmail(row.email),
          mobile: row.mobile,
          profile: { source: 'account', accountUserId: row.id },
          status
        })
      }
    }
  }

  return { total: rows.length, created, updated, skipped }
}

async function syncAccountProjects() {
  const rows = await queryRows<AccountProjectRow[]>(
    `SELECT id, project_code, parent_code, name, dept_code, leader_uid, description,
            repo_url, is_group, is_template, status, created_at
       FROM git_projects
      ORDER BY id ASC`
  )

  let created = 0
  let updated = 0
  for (const row of rows) {
    const existing = await queryRow<ExistingProjectRow>(
      'SELECT project_code FROM directory_projects WHERE project_code = ? LIMIT 1',
      [row.project_code]
    )
    await execute<ResultSetHeader>(
      `INSERT INTO directory_projects (
        project_code, parent_project_code, project_name, project_type, dept_code,
        leader_uid, repo_url, description, source_provider, external_ref,
        source_payload_hash, synced_at, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'account', ?, ?, NOW(), ?, COALESCE(?, NOW()), NOW())
      ON DUPLICATE KEY UPDATE
        parent_project_code = VALUES(parent_project_code),
        project_name = VALUES(project_name),
        project_type = VALUES(project_type),
        dept_code = VALUES(dept_code),
        leader_uid = VALUES(leader_uid),
        repo_url = VALUES(repo_url),
        description = VALUES(description),
        source_provider = VALUES(source_provider),
        external_ref = VALUES(external_ref),
        source_payload_hash = VALUES(source_payload_hash),
        synced_at = VALUES(synced_at),
        status = VALUES(status),
        updated_at = NOW()`,
      [
        row.project_code,
        row.parent_code,
        row.name,
        row.is_template ? 'template' : row.is_group ? 'group' : 'project',
        row.dept_code,
        row.leader_uid,
        row.repo_url,
        row.description,
        `account:project:${row.id}`,
        hashPayload(row),
        statusFromAccount(row.status),
        row.created_at
      ]
    )
    if (existing) updated++
    else created++
  }

  const memberships = await queryRows<AccountProjectMemberRow[]>(
    `SELECT pm.project_code, pm.uid, pm.role
       FROM git_project_members pm
       INNER JOIN directory_projects p ON p.project_code = pm.project_code
       INNER JOIN directory_users u ON u.uid = pm.uid
      ORDER BY pm.project_code ASC, pm.uid ASC`
  )
  await execute<ResultSetHeader>(
    `UPDATE directory_project_members
        SET status = 'inactive', left_at = COALESCE(left_at, NOW()), updated_at = NOW()
      WHERE source_provider = 'account'`,
    []
  )
  for (const membership of memberships) {
    const role = projectRoleFromAccount(membership.role)
    await execute<ResultSetHeader>(
      `INSERT INTO directory_project_members (
        project_code, uid, member_role, source_provider, external_ref,
        joined_at, left_at, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'account', ?, NOW(), NULL, 'active', NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        source_provider = VALUES(source_provider),
        external_ref = VALUES(external_ref),
        left_at = NULL,
        status = 'active',
        updated_at = NOW()`,
      [
        membership.project_code,
        membership.uid,
        role,
        `account:project_member:${membership.project_code}:${membership.uid}:${role}`
      ]
    )
  }

  return { total: rows.length, created, updated, skipped: 0 }
}

async function runAccountSync(input: RunnerInput): Promise<RunnerResult> {
  let total = 0
  let created = 0
  let updated = 0
  let skipped = 0

  if (input.objectScope === 'all' || input.objectScope === 'departments') {
    const result = await syncAccountDepartments()
    total += result.total
    created += result.created
    updated += result.updated
  }
  if (input.objectScope === 'all' || input.objectScope === 'users' || input.objectScope === 'identities') {
    const result = await syncAccountUsers(input.objectScope)
    total += result.total
    created += result.created
    updated += result.updated
    skipped += result.skipped
  }
  if (input.objectScope === 'all' || input.objectScope === 'projects') {
    const result = await syncAccountProjects()
    total += result.total
    created += result.created
    updated += result.updated
    skipped += result.skipped
  }

  await insertSummaryEvent(input.jobCode, 'account', `Imported Account directory data. total=${total}, created=${created}, updated=${updated}, skipped=${skipped}`)
  return {
    providerCode: 'account',
    integrationId: null,
    totalCount: total,
    createdCount: created,
    updatedCount: updated,
    deletedCount: 0,
    skippedCount: skipped,
    errorCount: 0,
    message: 'Account directory import completed'
  }
}

async function fetchLdapUsers(config: {
  host: string
  port: number
  bindDN: string
  bindPassword: string
  userBase: string
  useTLS: boolean
}) {
  const ldapModule = await importOptionalModule<LdapModule>('ldapjs')
  const ldap = ldapModule.default || ldapModule
  const createClient = ldap.createClient
  if (!createClient) {
    throw createError({ statusCode: 500, message: 'LDAP client is not available' })
  }

  return await new Promise<LdapUser[]>((resolve, reject) => {
    const protocol = config.useTLS ? 'ldaps' : 'ldap'
    const client = createClient({
      url: `${protocol}://${config.host}:${config.port}`,
      tlsOptions: {
        rejectUnauthorized: false
      }
    })

    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      client.unbind()
      reject(error)
    }

    client.on('error', fail)

    client.bind(config.bindDN, config.bindPassword, (bindError) => {
      if (bindError) {
        fail(bindError)
        return
      }

      const users: LdapUser[] = []
      client.search(config.userBase, {
        filter: '(objectClass=inetOrgPerson)',
        scope: 'sub',
        attributes: ['uid', 'cn', 'sn', 'mail', 'telephoneNumber']
      }, (searchError, response) => {
        if (searchError) {
          fail(searchError)
          return
        }

        response.on('searchEntry', (entry) => {
          const attrs = entry.pojo?.attributes || []
          const getAttr = (name: string) => {
            const attr = attrs.find((item: { type: string, values?: string[] }) => item.type === name)
            const value = attr?.values?.[0]
            return typeof value === 'string' ? value : null
          }

          const uid = getAttr('uid')
          if (!uid) return

          users.push({
            dn: entry.dn.toString(),
            uid,
            cn: getAttr('cn'),
            sn: getAttr('sn'),
            mail: getAttr('mail'),
            telephoneNumber: getAttr('telephoneNumber')
          })
        })

        response.on('error', fail)

        response.on('end', () => {
          if (settled) return
          settled = true
          client.unbind()
          resolve(users)
        })
      })
    })
  })
}

async function runLdapSync(input: RunnerInput): Promise<RunnerResult> {
  if (isCloudflareRuntime()) {
    throw createError({ statusCode: 501, message: 'LDAP directory sync is not supported in Cloudflare runtime' })
  }

  const source = await getDirectorySourceRuntimeConfig('ldap')
  if (!source) throw createError({ statusCode: 404, message: 'LDAP directory source is not configured' })
  if (source.status !== 'active') throw createError({ statusCode: 409, message: 'LDAP directory source is inactive' })

  const host = stringConfig(source.config, 'host')
  const bindDN = stringConfig(source.config, 'bindDN')
  const baseDN = stringConfig(source.config, 'baseDN')
  const userBase = stringConfig(source.config, 'userBase', baseDN)
  if (!host || !bindDN || !userBase) {
    throw createError({ statusCode: 400, message: 'LDAP directory source missing host, bindDN or userBase/baseDN' })
  }

  const users = await fetchLdapUsers({
    host,
    port: numberConfig(source.config, 'port', 636),
    bindDN,
    bindPassword: source.credential.secretValue,
    userBase,
    useTLS: booleanConfig(source.config, 'useTLS', true)
  })

  let created = 0
  let updated = 0
  let skipped = 0
  const externalRefs: string[] = []

  for (const user of users) {
    if (!user.uid) {
      skipped++
      continue
    }

    const email = normalizeEmail(user.mail) || null
    const uid = await findExistingUid('ldap', user.uid, email)
    const externalRef = `ldap:user:${user.uid}`
    externalRefs.push(externalRef)

    if (input.objectScope !== 'identities') {
      const result = await upsertUser({
        providerCode: 'ldap',
        uid,
        username: uid,
        displayName: user.sn || user.cn || uid,
        realName: user.sn || user.cn || null,
        avatarUrl: null,
        email,
        mobile: user.telephoneNumber,
        positionTitle: null,
        primaryDeptCode: null,
        externalRef,
        sourcePayload: user,
        status: 'active'
      })
      if (result === 'created') created++
      else updated++
    }

    await upsertIdentity({
      providerCode: 'ldap',
      uid,
      providerSubject: user.uid,
      providerUsername: user.uid,
      providerDn: user.dn,
      email,
      mobile: user.telephoneNumber,
      profile: { cn: user.cn, sn: user.sn },
      status: 'active'
    })
  }

  const deleted = input.objectScope === 'all'
    ? await markMissingProviderUsersDeleted('ldap', externalRefs)
    : 0

  const message = `LDAP sync finished. users=${users.length}, deleted=${deleted}`
  await insertSummaryEvent(input.jobCode, 'ldap', message)
  return {
    providerCode: 'ldap',
    integrationId: source.integrationId,
    totalCount: users.length,
    createdCount: created,
    updatedCount: updated,
    deletedCount: deleted,
    skippedCount: skipped,
    errorCount: 0,
    message
  }
}

async function getWecomToken(baseUrl: string, corpId: string, contactSecret: string) {
  const result = await $fetch<WecomTokenResponse>(`${baseUrl}/cgi-bin/gettoken`, {
    query: { corpid: corpId, corpsecret: contactSecret }
  })
  if (result.errcode !== 0 || !result.access_token) {
    throw new Error(`获取企业微信通讯录 token 失败: ${result.errcode} ${result.errmsg}`)
  }
  return result.access_token
}

async function runWecomSync(input: RunnerInput): Promise<RunnerResult> {
  const source = await getDirectorySourceRuntimeConfig('wecom')
  if (!source) throw createError({ statusCode: 404, message: 'WeCom directory source is not configured' })
  if (source.status !== 'active') throw createError({ statusCode: 409, message: 'WeCom directory source is inactive' })

  const corpId = stringConfig(source.config, 'corpId')
  if (!corpId) throw createError({ statusCode: 400, message: 'WeCom directory source missing corpId' })

  const baseUrl = source.baseUrl || 'https://qyapi.weixin.qq.com'
  const departmentId = numberConfig(source.config, 'syncDepartmentId', 1)
  const token = await getWecomToken(baseUrl, corpId, source.credential.secretValue)

  const deptResponse = await $fetch<WecomDepartmentResponse>(`${baseUrl}/cgi-bin/department/list`, {
    query: { access_token: token, id: departmentId }
  })
  if (deptResponse.errcode !== 0) {
    throw new Error(`获取企业微信部门失败: ${deptResponse.errcode} ${deptResponse.errmsg}`)
  }

  const userResponse = await $fetch<WecomUserListResponse>(`${baseUrl}/cgi-bin/user/list`, {
    query: { access_token: token, department_id: departmentId, fetch_child: 1 }
  })
  if (userResponse.errcode !== 0) {
    throw new Error(`获取企业微信用户失败: ${userResponse.errcode} ${userResponse.errmsg}`)
  }

  let created = 0
  let updated = 0
  let skipped = 0
  const memberships: Array<{ uid: string, deptCode: string, externalRef: string, isPrimary: boolean }> = []

  if (input.objectScope === 'all' || input.objectScope === 'departments' || input.objectScope === 'users' || input.objectScope === 'identities') {
    for (const dept of deptResponse.department || []) {
      const deptCode = `wecom_${dept.id}`
      const parentDeptCode = dept.parentid && dept.parentid !== dept.id ? `wecom_${dept.parentid}` : null
      const result = await upsertDepartment({
        providerCode: 'wecom',
        deptCode,
        deptName: dept.name,
        parentDeptCode,
        sortOrder: dept.order,
        externalRef: `wecom:department:${dept.id}`,
        sourcePayload: dept,
        status: 'active'
      })
      if (result === 'created') created++
      else updated++
    }
    await refreshDepartmentParents('wecom')
  }

  if (input.objectScope === 'all' || input.objectScope === 'users' || input.objectScope === 'identities') {
    for (const user of userResponse.userlist || []) {
      if (!user.userid) {
        skipped++
        continue
      }
      const email = normalizeEmail(user.email || user.biz_mail) || null
      const uid = await findExistingUid('wecom', user.userid, email)
      const firstDept = user.department?.[0] ? `wecom_${user.department[0]}` : null
      const active = !user.status || user.status === 1

      const result = await upsertUser({
        providerCode: 'wecom',
        uid,
        username: uid,
        displayName: user.name || uid,
        realName: user.name || null,
        avatarUrl: user.avatar || null,
        email,
        mobile: user.mobile || null,
        positionTitle: user.position || null,
        primaryDeptCode: firstDept,
        externalRef: `wecom:user:${user.userid}`,
        sourcePayload: user,
        status: statusFromProvider(active) as 'active' | 'inactive'
      })
      if (result === 'created') created++
      else updated++

      await upsertIdentity({
        providerCode: 'wecom',
        uid,
        providerSubject: user.userid,
        providerUsername: user.userid,
        email,
        mobile: user.mobile || null,
        profile: { name: user.name || null, avatar: user.avatar || null, department: user.department || [] },
        status: active ? 'active' : 'inactive'
      })

      for (const [index, deptId] of (user.department || []).entries()) {
        memberships.push({
          uid,
          deptCode: `wecom_${deptId}`,
          externalRef: `wecom:user:${user.userid}:department:${deptId}`,
          isPrimary: index === 0
        })
      }
    }

    if (input.objectScope === 'all' || input.objectScope === 'users') {
      await replaceUserDepartments('wecom', memberships)
    }
  }

  const total = (deptResponse.department || []).length + (userResponse.userlist || []).length
  const message = `WeCom sync finished. departments=${deptResponse.department?.length || 0}, users=${userResponse.userlist?.length || 0}`
  await insertSummaryEvent(input.jobCode, 'wecom', message)
  return { providerCode: 'wecom', integrationId: source.integrationId, totalCount: total, createdCount: created, updatedCount: updated, deletedCount: 0, skippedCount: skipped, errorCount: 0, message }
}

async function getDingTalkToken(baseUrl: string, appId: string, appSecret: string) {
  const result = await $fetch<DingTalkTokenResponse>(`${baseUrl}/v1.0/oauth2/accessToken`, {
    method: 'POST',
    body: { appKey: appId, appSecret }
  })
  if (!result.accessToken) throw new Error('获取钉钉 token 失败')
  return result.accessToken
}

async function fetchDingTalkDepartments(token: string, rootDeptId: number) {
  const departments: DingTalkDepartment[] = []

  async function fetchChildren(parentId: number) {
    const response = await $fetch<DingTalkDepartmentResponse>(
      'https://oapi.dingtalk.com/topapi/v2/department/listsub',
      {
        method: 'POST',
        query: { access_token: token },
        body: { dept_id: parentId, language: 'zh_CN' }
      }
    )
    if (response.errcode !== 0) throw new Error(`获取钉钉部门失败: ${response.errcode} ${response.errmsg}`)
    for (const dept of response.result || []) {
      departments.push(dept)
      await fetchChildren(dept.dept_id)
    }
  }

  await fetchChildren(rootDeptId)
  return departments
}

async function fetchDingTalkUsers(token: string, departmentIds: number[]) {
  const users = new Map<string, DingTalkUser>()
  for (const deptId of departmentIds) {
    let cursor = 0
    let hasMore = true
    while (hasMore) {
      const response = await $fetch<DingTalkUserListResponse>(
        'https://oapi.dingtalk.com/topapi/v2/user/list',
        {
          method: 'POST',
          query: { access_token: token },
          body: { dept_id: deptId, cursor, size: 100, language: 'zh_CN' }
        }
      )
      if (response.errcode !== 0) throw new Error(`获取钉钉用户失败: ${response.errcode} ${response.errmsg}`)
      for (const user of response.result?.list || []) {
        if (user.userid && !users.has(user.userid)) users.set(user.userid, user)
      }
      hasMore = Boolean(response.result?.has_more)
      cursor = response.result?.next_cursor || 0
    }
  }
  return Array.from(users.values())
}

async function runDingtalkSync(input: RunnerInput): Promise<RunnerResult> {
  const source = await getDirectorySourceRuntimeConfig('dingtalk')
  if (!source) throw createError({ statusCode: 404, message: 'DingTalk directory source is not configured' })
  if (source.status !== 'active') throw createError({ statusCode: 409, message: 'DingTalk directory source is inactive' })

  const appId = stringConfig(source.config, 'appId')
  if (!appId) throw createError({ statusCode: 400, message: 'DingTalk directory source missing appId' })

  const baseUrl = source.baseUrl || 'https://api.dingtalk.com'
  const rootDeptId = numberConfig(source.config, 'rootDeptId', 1)
  const token = await getDingTalkToken(baseUrl, appId, source.credential.secretValue)
  const departments = await fetchDingTalkDepartments(token, rootDeptId)
  const departmentIds = Array.from(new Set([rootDeptId, ...departments.map(dept => dept.dept_id)]))
  const users = await fetchDingTalkUsers(token, departmentIds)

  let created = 0
  let updated = 0
  let skipped = 0
  const memberships: Array<{ uid: string, deptCode: string, externalRef: string, isPrimary: boolean }> = []

  if (input.objectScope === 'all' || input.objectScope === 'departments' || input.objectScope === 'users' || input.objectScope === 'identities') {
    await upsertDepartment({
      providerCode: 'dingtalk',
      deptCode: `dingtalk_${rootDeptId}`,
      deptName: '钉钉根部门',
      parentDeptCode: null,
      externalRef: `dingtalk:department:${rootDeptId}`,
      sourcePayload: { dept_id: rootDeptId, name: '钉钉根部门' },
      status: 'active'
    })

    for (const dept of departments) {
      const result = await upsertDepartment({
        providerCode: 'dingtalk',
        deptCode: `dingtalk_${dept.dept_id}`,
        deptName: dept.name,
        parentDeptCode: dept.parent_id ? `dingtalk_${dept.parent_id}` : null,
        externalRef: `dingtalk:department:${dept.dept_id}`,
        sourcePayload: dept,
        status: 'active'
      })
      if (result === 'created') created++
      else updated++
    }
    await refreshDepartmentParents('dingtalk')
  }

  if (input.objectScope === 'all' || input.objectScope === 'users' || input.objectScope === 'identities') {
    for (const user of users) {
      if (!user.userid) {
        skipped++
        continue
      }
      const email = normalizeEmail(user.email) || null
      const uid = await findExistingUid('dingtalk', user.userid, email)
      const firstDept = user.dept_id_list?.[0] ? `dingtalk_${user.dept_id_list[0]}` : null
      const active = user.active !== false

      const result = await upsertUser({
        providerCode: 'dingtalk',
        uid,
        username: uid,
        displayName: user.name || uid,
        realName: user.name || null,
        avatarUrl: user.avatar || null,
        email,
        mobile: user.mobile || null,
        positionTitle: user.title || null,
        primaryDeptCode: firstDept,
        externalRef: `dingtalk:user:${user.userid}`,
        sourcePayload: user,
        status: statusFromProvider(active) as 'active' | 'inactive'
      })
      if (result === 'created') created++
      else updated++

      await upsertIdentity({
        providerCode: 'dingtalk',
        uid,
        providerSubject: user.userid,
        providerUsername: user.userid,
        email,
        mobile: user.mobile || null,
        profile: { name: user.name || null, avatar: user.avatar || null, deptIdList: user.dept_id_list || [] },
        status: active ? 'active' : 'inactive'
      })

      for (const [index, deptId] of (user.dept_id_list || []).entries()) {
        memberships.push({
          uid,
          deptCode: `dingtalk_${deptId}`,
          externalRef: `dingtalk:user:${user.userid}:department:${deptId}`,
          isPrimary: index === 0
        })
      }
    }

    if (input.objectScope === 'all' || input.objectScope === 'users') {
      await replaceUserDepartments('dingtalk', memberships)
    }
  }

  const total = departments.length + users.length
  const message = `DingTalk sync finished. departments=${departments.length}, users=${users.length}`
  await insertSummaryEvent(input.jobCode, 'dingtalk', message)
  return { providerCode: 'dingtalk', integrationId: source.integrationId, totalCount: total, createdCount: created, updatedCount: updated, deletedCount: 0, skippedCount: skipped, errorCount: 0, message }
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '')
}

function normalizeGitLabDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

function getConfigString(config: Record<string, unknown>, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = config[key]
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim()
    }
  }
  return fallback
}

function projectParentPath(projectCode: string) {
  const parts = projectCode.split('/').filter(Boolean)
  if (parts.length <= 1) return null
  return parts.slice(0, -1).join('/')
}

function gitlabMemberRole(accessLevel: number) {
  if (accessLevel >= 50) return 'owner'
  if (accessLevel >= 40) return 'admin'
  if (accessLevel >= 30) return 'member'
  return 'viewer'
}

async function gitlabFetchPage<T>(input: {
  baseUrl: string
  token: string
  path: string
  query?: Record<string, string | number | boolean | undefined>
}) {
  return await $fetch<T[]>(`${input.baseUrl}${input.path}`, {
    headers: { 'PRIVATE-TOKEN': input.token },
    query: input.query,
    timeout: 30000
  })
}

async function gitlabFetchAll<T>(input: {
  baseUrl: string
  token: string
  path: string
  query?: Record<string, string | number | boolean | undefined>
}) {
  const items: T[] = []
  let page = 1
  while (true) {
    const pageItems = await gitlabFetchPage<T>({
      ...input,
      query: {
        ...(input.query || {}),
        per_page: 100,
        page
      }
    })
    items.push(...pageItems)
    if (pageItems.length < 100) break
    page++
  }
  return items
}

async function getGitLabRuntime(input: RunnerInput) {
  const integrationCode = process.env.GITLAB_DIRECTORY_INTEGRATION_CODE || 'gitlab.default'
  const integration = await getIntegration(integrationCode)

  if (integration?.status === 'active') {
    const baseUrl = normalizeBaseUrl(String(integration.baseUrl || ''))
    if (!baseUrl) {
      throw createError({ statusCode: 400, message: `Integration ${integrationCode} missing baseUrl` })
    }
    const credential = integration.currentCredential
    if (!credential?.secretRef) {
      throw createError({ statusCode: 409, message: `Integration ${integrationCode} has no active credential` })
    }
    if (!input.event) {
      throw createError({ statusCode: 500, message: 'GitLab directory sync requires an H3 event to resolve vault secret' })
    }

    const secret = await resolveVaultSecret({
      event: input.event,
      secretRef: credential.secretRef,
      actor: {
        actorType: 'system',
        actorId: 'directory_sync',
        appCode: 'console'
      },
      purpose: 'directory_gitlab_sync'
    })
    const config = integration.config || {}
    return {
      integrationId: null,
      integrationCode,
      baseUrl,
      token: secret.value,
      groupPath: getConfigString(config, ['groupPath', 'rootGroupPath', 'syncGroupPath'], process.env.GITLAB_DIRECTORY_GROUP_PATH || ''),
      botUsername: getConfigString(config, ['botUsername'], process.env.GITLAB_BOT_USERNAME || 'bot')
    }
  }

  const baseUrl = process.env.GITLAB_BASE_URL ? normalizeBaseUrl(process.env.GITLAB_BASE_URL) : ''
  const token = process.env.GITLAB_BOT_TOKEN || process.env.GITLAB_API_TOKEN || ''
  if (!baseUrl || !token) {
    throw createError({ statusCode: 503, message: `GitLab integration ${integrationCode} is not configured` })
  }

  return {
    integrationId: null,
    integrationCode: 'env',
    baseUrl,
    token,
    groupPath: process.env.GITLAB_DIRECTORY_GROUP_PATH || '',
    botUsername: process.env.GITLAB_BOT_USERNAME || 'bot'
  }
}

async function loadDirectoryUserDeptMap() {
  const rows = await queryRows<DirectoryUserDeptRow[]>(
    `SELECT u.uid,
            COALESCE(
              (SELECT d2.dept_code
                 FROM directory_user_departments ud2
                 INNER JOIN directory_departments d2 ON d2.dept_code = ud2.dept_code
                WHERE ud2.uid = u.uid
                  AND ud2.status = 'active'
                  AND d2.status = 'active'
                  AND d2.org_type = 'department'
                ORDER BY ud2.is_primary DESC, d2.sort_order ASC, d2.id ASC
                LIMIT 1),
              u.primary_dept_code
            ) AS dept_code
       FROM directory_users u
      WHERE u.status = 'active'`
  )

  return {
    users: new Set(rows.map(row => row.uid)),
    userDeptMap: new Map(rows.map(row => [row.uid, row.dept_code]))
  }
}

async function loadGitLabGroups(runtime: Awaited<ReturnType<typeof getGitLabRuntime>>) {
  const groupPath = runtime.groupPath.trim().replace(/^\/+|\/+$/g, '')
  if (!groupPath) {
    return await gitlabFetchAll<GitLabGroup>({
      baseUrl: runtime.baseUrl,
      token: runtime.token,
      path: '/api/v4/groups',
      query: { all_available: true, top_level_only: false }
    })
  }

  const rootGroup = await $fetch<GitLabGroup>(
    `${runtime.baseUrl}/api/v4/groups/${encodeURIComponent(groupPath)}`,
    {
      headers: { 'PRIVATE-TOKEN': runtime.token },
      timeout: 30000
    }
  )
  const descendants = await gitlabFetchAll<GitLabGroup>({
    baseUrl: runtime.baseUrl,
    token: runtime.token,
    path: `/api/v4/groups/${rootGroup.id}/descendant_groups`,
    query: { all_available: true }
  })
  return [rootGroup, ...descendants]
}

async function loadGitLabProjects(runtime: Awaited<ReturnType<typeof getGitLabRuntime>>) {
  const groupPath = runtime.groupPath.trim().replace(/^\/+|\/+$/g, '')
  if (!groupPath) {
    return await gitlabFetchAll<GitLabProject>({
      baseUrl: runtime.baseUrl,
      token: runtime.token,
      path: '/api/v4/projects',
      query: {
        archived: false,
        with_custom_attributes: false
      }
    })
  }

  const rootGroup = await $fetch<GitLabGroup>(
    `${runtime.baseUrl}/api/v4/groups/${encodeURIComponent(groupPath)}`,
    {
      headers: { 'PRIVATE-TOKEN': runtime.token },
      timeout: 30000
    }
  )
  return await gitlabFetchAll<GitLabProject>({
    baseUrl: runtime.baseUrl,
    token: runtime.token,
    path: `/api/v4/groups/${rootGroup.id}/projects`,
    query: {
      include_subgroups: true,
      archived: false,
      with_custom_attributes: false
    }
  })
}

async function getGitLabMembers(input: {
  runtime: Awaited<ReturnType<typeof getGitLabRuntime>>
  targetType: 'groups' | 'projects'
  idOrPath: number | string
  all?: boolean
}) {
  const id = typeof input.idOrPath === 'number' ? String(input.idOrPath) : encodeURIComponent(input.idOrPath)
  return await gitlabFetchAll<GitLabMember>({
    baseUrl: input.runtime.baseUrl,
    token: input.runtime.token,
    path: `/api/v4/${input.targetType}/${id}/members${input.all === false ? '' : '/all'}`
  })
}

async function upsertGitLabProject(input: {
  projectCode: string
  parentProjectCode: string | null
  projectName: string
  projectType: 'group' | 'project'
  repoUrl: string
  leaderUid: string | null
  deptCode: string | null
  description: string | null
  externalRef: string
  sourcePayload: unknown
  createdAt: string | null
}) {
  const existing = await queryRow<ExistingProjectRow>(
    'SELECT project_code FROM directory_projects WHERE project_code = ? LIMIT 1',
    [input.projectCode]
  )

  await execute<ResultSetHeader>(
    `INSERT INTO directory_projects (
      project_code,
      parent_project_code,
      project_name,
      project_type,
      dept_code,
      leader_uid,
      repo_url,
      description,
      source_provider,
      external_ref,
      source_payload_hash,
      synced_at,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'gitlab', ?, ?, NOW(), 'active', COALESCE(?, NOW()), NOW())
    ON DUPLICATE KEY UPDATE
      parent_project_code = VALUES(parent_project_code),
      project_name = VALUES(project_name),
      project_type = VALUES(project_type),
      dept_code = VALUES(dept_code),
      leader_uid = VALUES(leader_uid),
      repo_url = VALUES(repo_url),
      description = VALUES(description),
      source_provider = VALUES(source_provider),
      external_ref = VALUES(external_ref),
      source_payload_hash = VALUES(source_payload_hash),
      synced_at = VALUES(synced_at),
      status = VALUES(status),
      updated_at = NOW()`,
    [
      input.projectCode,
      input.parentProjectCode,
      input.projectName,
      input.projectType,
      input.deptCode,
      input.leaderUid,
      input.repoUrl,
      input.description,
      input.externalRef,
      hashPayload(input.sourcePayload),
      input.createdAt
    ]
  )

  return existing ? 'updated' : 'created'
}

async function replaceGitLabProjectMembers(input: {
  projectCode: string
  members: GitLabMember[]
  existingUsers: Set<string>
  botUsername: string
}) {
  await execute<ResultSetHeader>(
    `UPDATE directory_project_members
        SET status = 'inactive',
            left_at = COALESCE(left_at, NOW()),
            updated_at = NOW()
      WHERE project_code = ?
        AND source_provider = 'gitlab'`,
    [input.projectCode]
  )

  let skipped = 0
  for (const member of input.members) {
    const uid = member.username
    if (!uid || uid === input.botUsername || !input.existingUsers.has(uid)) {
      skipped++
      continue
    }

    await execute<ResultSetHeader>(
      `INSERT INTO directory_project_members (
        project_code,
        uid,
        member_role,
        source_provider,
        external_ref,
        joined_at,
        left_at,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, 'gitlab', ?, NOW(), NULL, 'active', NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        external_ref = VALUES(external_ref),
        left_at = NULL,
        status = 'active',
        updated_at = NOW()`,
      [
        input.projectCode,
        uid,
        gitlabMemberRole(member.access_level),
        `gitlab:member:${input.projectCode}:${uid}`
      ]
    )
  }
  return skipped
}

async function runGitLabSync(input: RunnerInput): Promise<RunnerResult> {
  const runtime = await getGitLabRuntime(input)
  const [{ users: existingUsers, userDeptMap }, groups, projects] = await Promise.all([
    loadDirectoryUserDeptMap(),
    loadGitLabGroups(runtime),
    loadGitLabProjects(runtime)
  ])

  const groupCodes = new Set(groups.map(group => group.full_path))
  const sortedGroups = [...groups].sort((a, b) => a.full_path.split('/').length - b.full_path.split('/').length)
  let created = 0
  let updated = 0
  let skipped = 0
  let errors = 0

  for (const group of sortedGroups) {
    let leaderUid: string | null = null
    let deptCode: string | null = null
    let members: GitLabMember[] = []
    try {
      members = await getGitLabMembers({
        runtime,
        targetType: 'groups',
        idOrPath: group.id
      })
      const owner = members.find(member => member.access_level >= 50 && member.username !== runtime.botUsername && existingUsers.has(member.username))
      leaderUid = owner?.username || null
      deptCode = leaderUid ? userDeptMap.get(leaderUid) || null : null
    } catch {
      errors++
    }

    const parent = projectParentPath(group.full_path)
    const result = await upsertGitLabProject({
      projectCode: group.full_path,
      parentProjectCode: parent && groupCodes.has(parent) ? parent : null,
      projectName: group.name || group.path,
      projectType: 'group',
      repoUrl: `${runtime.baseUrl}/${group.full_path}`,
      leaderUid,
      deptCode,
      description: group.description,
      externalRef: `gitlab:group:${group.id}`,
      sourcePayload: group,
      createdAt: normalizeGitLabDate(group.created_at)
    })
    if (result === 'created') created++
    else updated++

    skipped += await replaceGitLabProjectMembers({
      projectCode: group.full_path,
      members,
      existingUsers,
      botUsername: runtime.botUsername
    })
  }

  for (const project of projects.filter(project => !project.archived)) {
    const projectCode = project.path_with_namespace
    let leaderUid: string | null = null
    let deptCode: string | null = null
    let members: GitLabMember[] = []
    try {
      members = await getGitLabMembers({
        runtime,
        targetType: 'projects',
        idOrPath: project.id
      })
      const owner = members.find(member => member.access_level >= 50 && member.username !== runtime.botUsername && existingUsers.has(member.username))
      leaderUid = owner?.username || null
      deptCode = leaderUid ? userDeptMap.get(leaderUid) || null : null
    } catch {
      errors++
    }

    const namespacePath = project.namespace?.kind === 'group' ? project.namespace.full_path : projectParentPath(projectCode)
    const result = await upsertGitLabProject({
      projectCode,
      parentProjectCode: namespacePath && groupCodes.has(namespacePath) ? namespacePath : null,
      projectName: project.name || project.path,
      projectType: 'project',
      repoUrl: `${runtime.baseUrl}/${projectCode}`,
      leaderUid,
      deptCode,
      description: project.description,
      externalRef: `gitlab:project:${project.id}`,
      sourcePayload: project,
      createdAt: normalizeGitLabDate(project.created_at)
    })
    if (result === 'created') created++
    else updated++

    skipped += await replaceGitLabProjectMembers({
      projectCode,
      members,
      existingUsers,
      botUsername: runtime.botUsername
    })
  }

  const total = groups.length + projects.filter(project => !project.archived).length
  const message = `GitLab sync finished. groups=${groups.length}, projects=${projects.filter(project => !project.archived).length}, skippedMembers=${skipped}`
  await insertSummaryEvent(input.jobCode, 'gitlab', message)
  return {
    providerCode: 'gitlab',
    integrationId: runtime.integrationId,
    totalCount: total,
    createdCount: created,
    updatedCount: updated,
    deletedCount: 0,
    skippedCount: skipped,
    errorCount: errors,
    message
  }
}

export async function runDirectoryProviderSync(input: RunnerInput): Promise<RunnerResult> {
  ensureScope(input.providerCode, input.objectScope)

  if (input.providerCode === 'account') return await runAccountSync(input)
  if (input.providerCode === 'gitlab') return await runGitLabSync(input)
  if (input.providerCode === 'wecom') return await runWecomSync(input)
  if (input.providerCode === 'dingtalk') return await runDingtalkSync(input)
  return await runLdapSync(input)
}
