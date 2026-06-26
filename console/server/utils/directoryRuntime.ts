import type { RowDataPacket } from 'mysql2/promise'
import { queryRow, queryRows } from '~~/server/utils/db'

export interface DirectoryQuery {
  search?: string
  keyword?: string
  dept_code?: string
  deptCode?: string
  status?: string
  only_group?: string
  onlyGroup?: string
  include_template?: string
  includeTemplate?: string
  parent_id?: string
  parentProjectCode?: string
  leader_uid?: string
  leaderUid?: string
  role?: string
  cursor?: string
  limit?: string | number
  subject_type?: string
  changed_after?: string
}

interface DirectoryUserRow extends RowDataPacket {
  id: number
  uid: string
  username: string | null
  display_name: string | null
  real_name: string | null
  nickname: string | null
  avatar_url: string | null
  email: string | null
  mobile: string | null
  mobile_tail4: string | null
  position_title: string | null
  gender: string
  primary_dept_code: string | null
  primary_dept_name: string | null
  user_type: string
  source_provider: string
  external_ref: string | null
  last_login_at: string | null
  dingtalk_id: string | null
  status: string
  created_at: string
  updated_at: string
}

interface DepartmentRow extends RowDataPacket {
  id: number
  dept_code: string
  dept_name: string
  parent_id: number | null
  parent_dept_code: string | null
  dept_path: string | null
  level_no: number
  sort_order: number
  manager_uid: string | null
  manager_name: string | null
  leader_uid: string | null
  leader_name: string | null
  org_type: string
  dept_category: string | null
  description: string | null
  status: string
  created_at: string
  updated_at: string
}

interface ProjectRow extends RowDataPacket {
  id: number
  project_code: string
  parent_project_code: string | null
  project_name: string
  project_type: string
  dept_code: string | null
  owner_uid: string | null
  leader_uid: string | null
  repo_url: string | null
  description: string | null
  status: string
  created_at: string
  updated_at: string
  member_role?: string | null
}

interface ProjectMemberRow extends RowDataPacket {
  id: number
  project_code: string
  uid: string
  member_role: string
  source_provider: string
  external_ref: string | null
  joined_at: string
  left_at: string | null
  status: string
  display_name: string | null
  real_name: string | null
  email: string | null
  mobile_tail4: string | null
  primary_dept_code: string | null
  dept_name: string | null
}

interface UserDepartmentRow extends RowDataPacket {
  uid: string
  dept_code: string
  relation_type: string
  is_primary: number
  status: string
  dept_name: string | null
  parent_dept_code: string | null
  org_type: string | null
}

interface SubjectExportRow extends RowDataPacket {
  subject_type: string
  subject_code: string
  external_ref: string | null
  parent_subject_type: string | null
  parent_subject_code: string | null
  source_object_type: string
  source_object_code: string
  snapshot_hash: string
  status: string
  exported_at: string
  updated_at: string
}

interface SubjectMembershipRow extends RowDataPacket {
  subject_code: string
  container_subject_code: string
  container_org_type: string | null
  relation_type: string
  is_primary: number
  status: string
  updated_at: string
}

export interface DeptNode {
  id?: number
  deptCode: string
  name: string
  parentId: string | null
  level: number
  orgType: string
  deptCategory: string | null
  managerId: string | null
  manager: string | null
  leaderId: string | null
  leader: string | null
  description?: string | null
  sortOrder?: number
  children: DeptNode[]
  users?: AccountUserItem[]
}

export interface AccountUserItem {
  id: number
  uid: string
  username?: string | null
  displayName?: string | null
  realName: string | null
  nickname: string | null
  email: string | null
  mobile: string | null
  mobileTail4?: string | null
  avatar: string | null
  gender: number
  status?: number
  deptCode: string | null
  deptName: string | null
  positionTitle?: string | null
  userType?: string
  dingtalkId?: string | null
}

export interface ProjectItem {
  id: number
  projectCode: string
  parentId: string | null
  name: string
  deptCode: string | null
  ownerUid?: string | null
  leaderUid: string | null
  description: string | null
  status: number
  statusKey?: string
  repoUrl: string | null
  isGroup: number
  isTemplate: number
  docsSyncedAt: string | null
  docsCommittedAt: string | null
  role?: string | null
  subProjects: ProjectItem[]
}

function getSearch(query: DirectoryQuery) {
  return String(query.search || query.keyword || '').trim()
}

function statusToAccount(status: string) {
  if (status === 'active') return 1
  if (status === 'deleted') return -1
  return 0
}

function genderToAccount(gender: string) {
  if (gender === 'male') return 1
  if (gender === 'female') return 2
  return 0
}

function isTrue(value: unknown) {
  return value === true || value === 'true' || value === '1' || value === 1
}

function isFalse(value: unknown) {
  return value === false || value === 'false' || value === '0' || value === 0
}

function normalizeLimit(limit: unknown, fallback = 500, max = 1000) {
  const parsed = Number(limit || fallback)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.floor(parsed), max)
}

function primaryDepartmentJoin(userAlias = 'u') {
  return `LEFT JOIN (
      SELECT ranked.uid, ranked.dept_code, ranked.dept_name
      FROM (
        SELECT ud.uid,
               ud.dept_code,
               d.dept_name,
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
    ) pd ON pd.uid = ${userAlias}.uid`
}

const userSelectColumns = `u.id,
       u.uid,
       u.username,
       u.display_name,
       u.real_name,
       u.nickname,
       u.avatar_url,
       u.email,
       u.mobile,
       u.mobile_tail4,
       u.position_title,
       u.gender,
       pd.dept_code AS primary_dept_code,
       pd.dept_name AS primary_dept_name,
       u.user_type,
       u.source_provider,
       u.external_ref,
       u.last_login_at,
       di_dingtalk.provider_subject AS dingtalk_id,
       u.status,
       u.created_at,
       u.updated_at`

function identityJoin(userAlias = 'u') {
  return `LEFT JOIN directory_identities di_dingtalk
      ON di_dingtalk.uid = ${userAlias}.uid
     AND di_dingtalk.provider_code = 'dingtalk'
     AND di_dingtalk.status = 'active'`
}

function normalizeUser(row: DirectoryUserRow): AccountUserItem {
  return {
    id: row.id,
    uid: row.uid,
    username: row.username,
    displayName: row.display_name,
    realName: row.real_name || row.display_name || row.username || row.uid,
    nickname: row.nickname,
    email: row.email,
    mobile: row.mobile,
    mobileTail4: row.mobile_tail4,
    avatar: row.avatar_url,
    gender: genderToAccount(row.gender),
    status: statusToAccount(row.status),
    deptCode: row.primary_dept_code,
    deptName: row.primary_dept_name,
    positionTitle: row.position_title,
    userType: row.user_type,
    dingtalkId: row.dingtalk_id
  }
}

function normalizeDepartment(row: DepartmentRow): DeptNode {
  return {
    id: row.id,
    deptCode: row.dept_code,
    name: row.dept_name,
    parentId: row.parent_dept_code,
    level: row.level_no,
    orgType: row.org_type || 'department',
    deptCategory: row.dept_category,
    managerId: row.manager_uid,
    manager: row.manager_name,
    leaderId: row.leader_uid,
    leader: row.leader_name,
    description: row.description,
    sortOrder: row.sort_order,
    children: []
  }
}

function normalizeProject(row: ProjectRow): ProjectItem {
  return {
    id: row.id,
    projectCode: row.project_code,
    parentId: row.parent_project_code,
    name: row.project_name,
    deptCode: row.dept_code,
    ownerUid: row.owner_uid,
    leaderUid: row.leader_uid,
    description: row.description,
    status: statusToAccount(row.status),
    statusKey: row.status,
    repoUrl: row.repo_url,
    isGroup: row.project_type === 'group' ? 1 : 0,
    isTemplate: row.project_type === 'template' ? 1 : 0,
    docsSyncedAt: null,
    docsCommittedAt: null,
    role: row.member_role || undefined,
    subProjects: []
  }
}

function normalizeProjectMember(row: ProjectMemberRow) {
  return {
    id: row.id,
    projectCode: row.project_code,
    uid: row.uid,
    role: row.member_role,
    sourceProvider: row.source_provider,
    externalRef: row.external_ref,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
    status: row.status,
    displayName: row.display_name || row.real_name || row.uid,
    realName: row.real_name,
    email: row.email,
    mobileTail4: row.mobile_tail4,
    primaryDeptCode: row.primary_dept_code,
    deptName: row.dept_name
  }
}

function buildDepartmentTree(rows: DepartmentRow[]) {
  const nodes = new Map<string, DeptNode>()
  const roots: DeptNode[] = []

  for (const row of rows) {
    nodes.set(row.dept_code, normalizeDepartment(row))
  }

  for (const row of rows) {
    const node = nodes.get(row.dept_code)
    if (!node) continue
    if (row.parent_dept_code && nodes.has(row.parent_dept_code)) {
      nodes.get(row.parent_dept_code)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return {
    tree: roots,
    flat: rows.map(row => normalizeDepartment(row))
  }
}

function buildProjectTree(items: ProjectItem[]) {
  const map = new Map<string, ProjectItem>()
  const roots: ProjectItem[] = []

  for (const item of items) {
    item.subProjects = []
    map.set(item.projectCode, item)
  }

  for (const item of items) {
    if (item.parentId && map.has(item.parentId)) {
      map.get(item.parentId)!.subProjects.push(item)
    } else {
      roots.push(item)
    }
  }

  return roots
}

async function getDepartmentRows(status = 'active') {
  const params: unknown[] = []
  let where = 'WHERE 1=1'
  if (status !== 'all') {
    where += ' AND d.status = ?'
    params.push(status)
  }

  return queryRows<DepartmentRow[]>(
    `SELECT d.id, d.dept_code, d.dept_name, d.parent_id, d.parent_dept_code,
            d.dept_path, d.level_no, d.sort_order, d.manager_uid,
            mu.display_name AS manager_name, d.leader_uid, lu.display_name AS leader_name,
            d.org_type, d.dept_category, d.description, d.status, d.created_at, d.updated_at
       FROM directory_departments d
       LEFT JOIN directory_users mu ON mu.uid = d.manager_uid
       LEFT JOIN directory_users lu ON lu.uid = d.leader_uid
       ${where}
       ORDER BY d.sort_order ASC, d.id ASC`,
    params
  )
}

export async function getDirectoryMeta() {
  const [userCount, departmentCount, projectCount, latestSync] = await Promise.all([
    queryRow<RowDataPacket & { count: number }>('SELECT COUNT(*) AS count FROM directory_users WHERE status = ?', ['active']),
    queryRow<RowDataPacket & { count: number }>('SELECT COUNT(*) AS count FROM directory_departments WHERE status = ?', ['active']),
    queryRow<RowDataPacket & { count: number }>('SELECT COUNT(*) AS count FROM directory_projects WHERE status = ?', ['active']),
    queryRow<RowDataPacket & { synced_at: string | null }>('SELECT MAX(synced_at) AS synced_at FROM directory_users')
  ])

  return {
    contractVersion: 'directory.v1',
    provider: 'console',
    status: 'active',
    userCount: Number(userCount?.count || 0),
    departmentCount: Number(departmentCount?.count || 0),
    projectCount: Number(projectCount?.count || 0),
    lastSyncedAt: latestSync?.synced_at || null
  }
}

export async function listDirectoryUsers(query: DirectoryQuery = {}) {
  const params: unknown[] = []
  let sql = `SELECT ${userSelectColumns}
       FROM directory_users u
       ${primaryDepartmentJoin('u')}
       ${identityJoin('u')}
       WHERE u.user_type <> 'system'`

  const status = String(query.status || 'active')
  if (status !== 'all') {
    sql += ' AND u.status = ?'
    params.push(status)
  }

  const search = getSearch(query)
  if (search) {
    sql += ' AND (u.uid LIKE ? OR u.username LIKE ? OR u.display_name LIKE ? OR u.real_name LIKE ? OR u.email LIKE ?)'
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
  }

  const deptCode = String(query.dept_code || query.deptCode || '').trim()
  if (deptCode) {
    sql += ` AND EXISTS (
      SELECT 1 FROM directory_user_departments ud
      WHERE ud.uid = u.uid AND ud.dept_code = ? AND ud.status = 'active'
    )`
    params.push(deptCode)
  }

  sql += ' ORDER BY u.uid ASC'

  const rows = await queryRows<DirectoryUserRow[]>(sql, params)
  const items = rows.map(normalizeUser)
  const departments = await listDirectoryDepartments()

  for (const node of departments.tree) {
    attachUsersToDepartment(node, items)
  }

  return {
    items,
    total: items.length,
    tree: departments.tree
  }
}

function attachUsersToDepartment(node: DeptNode, users: AccountUserItem[]) {
  node.users = users.filter(user => user.deptCode === node.deptCode)
  for (const child of node.children) {
    attachUsersToDepartment(child, users)
  }
}

export async function getDirectoryUser(uid: string) {
  const row = await queryRow<DirectoryUserRow>(
    `SELECT ${userSelectColumns}
       FROM directory_users u
       ${primaryDepartmentJoin('u')}
       ${identityJoin('u')}
      WHERE u.uid = ? AND u.status = 'active'
      LIMIT 1`,
    [uid]
  )

  return row ? normalizeUser(row) : null
}

export async function getDirectoryUserForAdmin(uid: string) {
  const row = await queryRow<DirectoryUserRow>(
    `SELECT ${userSelectColumns}
       FROM directory_users u
       ${primaryDepartmentJoin('u')}
       ${identityJoin('u')}
      WHERE u.uid = ?
      LIMIT 1`,
    [uid]
  )

  return row ? normalizeUser(row) : null
}

export async function batchDirectoryUsers(uids: string[]) {
  const uniqueUids = [...new Set(uids.map(uid => String(uid || '').trim()).filter(Boolean))]
  if (uniqueUids.length === 0) return []

  const placeholders = uniqueUids.map(() => '?').join(',')
  const rows = await queryRows<DirectoryUserRow[]>(
    `SELECT ${userSelectColumns}
       FROM directory_users u
       ${primaryDepartmentJoin('u')}
       ${identityJoin('u')}
      WHERE u.uid IN (${placeholders})`,
    uniqueUids
  )

  return rows.map(normalizeUser)
}

export async function listDirectoryDepartments(query: DirectoryQuery = {}) {
  const status = String(query.status || 'active')
  const rows = await getDepartmentRows(status)
  return buildDepartmentTree(rows)
}

export async function listAccessibleDepartments(uid: string) {
  const normalizedUid = String(uid || '').trim()
  if (!normalizedUid) return []

  const [departmentRows, relationRows] = await Promise.all([
    getDepartmentRows('active'),
    queryRows<UserDepartmentRow[]>(
      `SELECT ud.uid, ud.dept_code, ud.relation_type, ud.is_primary, ud.status,
              d.dept_name, d.parent_dept_code, d.org_type
         FROM directory_user_departments ud
         INNER JOIN directory_departments d ON d.dept_code = ud.dept_code
        WHERE ud.uid = ?
          AND ud.status = 'active'
          AND d.status = 'active'`,
      [normalizedUid]
    )
  ])

  const directCodes = new Set<string>()
  for (const row of relationRows) {
    directCodes.add(row.dept_code)
  }
  for (const row of departmentRows) {
    if (row.manager_uid === normalizedUid || row.leader_uid === normalizedUid) {
      directCodes.add(row.dept_code)
    }
  }

  const childrenByParent = new Map<string, DepartmentRow[]>()
  for (const row of departmentRows) {
    if (!row.parent_dept_code) continue
    const children = childrenByParent.get(row.parent_dept_code) || []
    children.push(row)
    childrenByParent.set(row.parent_dept_code, children)
  }

  const accessibleCodes = new Set<string>()
  const visit = (deptCode: string) => {
    if (accessibleCodes.has(deptCode)) return
    accessibleCodes.add(deptCode)
    for (const child of childrenByParent.get(deptCode) || []) {
      visit(child.dept_code)
    }
  }

  for (const deptCode of directCodes) {
    visit(deptCode)
  }

  return departmentRows
    .filter(row => accessibleCodes.has(row.dept_code))
    .filter(row => (row.org_type || 'department') === 'department')
    .filter(row => Boolean(row.parent_dept_code || row.parent_id))
    .map(row => normalizeDepartment(row))
}

export async function getDirectoryDepartment(deptCode: string) {
  const rows = await getDepartmentRows('all')
  const department = rows.find(row => row.dept_code === deptCode)
  return department ? normalizeDepartment(department) : null
}

export async function listDirectoryDepartmentMembers(deptCode: string, query: DirectoryQuery = {}) {
  const params: unknown[] = [deptCode]
  let sql = `SELECT ${userSelectColumns}
       FROM directory_user_departments ud
       INNER JOIN directory_users u ON u.uid = ud.uid
       INNER JOIN directory_departments d ON d.dept_code = ud.dept_code
       ${primaryDepartmentJoin('u')}
       ${identityJoin('u')}
      WHERE ud.dept_code = ? AND ud.status = 'active' AND u.status = 'active'`

  const search = getSearch(query)
  if (search) {
    sql += ' AND (u.uid LIKE ? OR u.display_name LIKE ? OR u.real_name LIKE ? OR u.email LIKE ?)'
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
  }

  sql += ' ORDER BY ud.is_primary DESC, u.uid ASC'

  const rows = await queryRows<DirectoryUserRow[]>(sql, params)
  const items = rows.map(normalizeUser)
  return { items, total: items.length }
}

export async function listDirectoryUserDepartments(uid?: string) {
  const params: unknown[] = []
  let sql = `SELECT ud.uid, ud.dept_code, ud.relation_type, ud.is_primary, ud.status,
                    d.dept_name, d.parent_dept_code, d.org_type
       FROM directory_user_departments ud
       INNER JOIN directory_users u ON u.uid = ud.uid
       INNER JOIN directory_departments d ON d.dept_code = ud.dept_code
      WHERE ud.status = 'active' AND u.status = 'active' AND d.status = 'active'`

  if (uid) {
    sql += ' AND ud.uid = ?'
    params.push(uid)
  }

  sql += ` ORDER BY ud.uid ASC,
    CASE WHEN d.org_type = 'department' AND ud.relation_type = 'member' THEN 0 ELSE 1 END,
    ud.is_primary DESC,
    d.sort_order ASC`
  const rows = await queryRows<UserDepartmentRow[]>(sql, params)

  if (!uid) {
    return rows.map(row => ({
      uid: row.uid,
      deptCode: row.dept_code,
      relationType: row.relation_type,
      isPrimary: Boolean(row.is_primary)
    }))
  }

  const departments = rows.map(row => ({
    deptCode: row.dept_code,
    name: row.dept_name || row.dept_code,
    parentId: row.parent_dept_code,
    orgType: row.org_type || 'department',
    relationType: row.relation_type,
    isPrimary: Boolean(row.is_primary),
    children: []
  }))
  const primary = rows.find(row => row.org_type === 'department' && row.relation_type === 'member')
  return {
    departments,
    primaryDeptCode: primary?.dept_code || null
  }
}

export async function listDirectoryProjects(query: DirectoryQuery = {}) {
  const params: unknown[] = []
  let sql = 'SELECT * FROM directory_projects WHERE 1=1'

  const status = String(query.status || 'active')
  if (status !== 'all') {
    sql += ' AND status = ?'
    params.push(status)
  }

  const search = getSearch(query)
  if (search) {
    sql += ' AND (project_code LIKE ? OR project_name LIKE ?)'
    params.push(`%${search}%`, `%${search}%`)
  }

  const deptCode = String(query.dept_code || query.deptCode || '').trim()
  if (deptCode) {
    sql += ' AND dept_code = ?'
    params.push(deptCode)
  }

  const leaderUid = String(query.leader_uid || query.leaderUid || '').trim()
  if (leaderUid) {
    sql += ' AND leader_uid = ?'
    params.push(leaderUid)
  }

  const parentProjectCode = String(query.parent_id || query.parentProjectCode || '').trim()
  if (parentProjectCode) {
    sql += ' AND parent_project_code = ?'
    params.push(parentProjectCode)
  }

  if (isTrue(query.only_group || query.onlyGroup)) {
    sql += ' AND project_type = \'group\''
  }

  if (isFalse(query.include_template || query.includeTemplate)) {
    sql += ' AND project_type <> \'template\''
  }

  sql += ' ORDER BY created_at ASC, id ASC'

  const rows = await queryRows<ProjectRow[]>(sql, params)
  const items = rows.map(normalizeProject)
  return {
    items: buildProjectTree(items),
    flat: items,
    total: items.length
  }
}

export async function getDirectoryProject(projectCode: string) {
  const row = await queryRow<ProjectRow>(
    'SELECT * FROM directory_projects WHERE project_code = ? LIMIT 1',
    [projectCode]
  )
  return row ? normalizeProject(row) : null
}

export async function listDirectoryProjectMembers(projectCode: string, query: DirectoryQuery = {}) {
  const params: unknown[] = [projectCode]
  let sql = `
    SELECT pm.*,
           u.display_name,
           u.real_name,
           u.email,
           u.mobile_tail4,
           pd.dept_code AS primary_dept_code,
           pd.dept_name
      FROM directory_project_members pm
      LEFT JOIN directory_users u ON u.uid = pm.uid
      ${primaryDepartmentJoin('u')}
     WHERE pm.project_code = ?
  `

  const status = String(query.status || 'active')
  if (status !== 'all') {
    sql += ' AND pm.status = ?'
    params.push(status)
  }

  const role = String(query.role || '').trim()
  if (role) {
    sql += ' AND pm.member_role = ?'
    params.push(role)
  }

  const search = getSearch(query)
  if (search) {
    sql += ' AND (pm.uid LIKE ? OR u.display_name LIKE ? OR u.real_name LIKE ? OR u.email LIKE ?)'
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
  }

  sql += ' ORDER BY FIELD(pm.member_role, \'owner\', \'admin\', \'member\', \'viewer\'), pm.uid ASC'

  const rows = await queryRows<ProjectMemberRow[]>(sql, params)
  const items = rows.map(normalizeProjectMember)
  return {
    items,
    total: items.length
  }
}

export async function listDirectoryUserProjects(uid: string, query: DirectoryQuery = {}) {
  const filters: string[] = ['p.status = \'active\'']
  const params: unknown[] = []

  if (isTrue(query.only_group || query.onlyGroup)) {
    filters.push('p.project_type = \'group\'')
  }
  if (isFalse(query.include_template || query.includeTemplate)) {
    filters.push('p.project_type <> \'template\'')
  }

  const where = filters.length ? `AND ${filters.join(' AND ')}` : ''

  const managedRows = await queryRows<ProjectRow[]>(
    `SELECT p.*, 'owner' AS member_role
       FROM directory_projects p
      WHERE p.leader_uid = ? ${where}
      ORDER BY p.created_at DESC`,
    [uid, ...params]
  )

  const joinedRows = await queryRows<ProjectRow[]>(
    `SELECT p.*, pm.member_role
       FROM directory_project_members pm
       INNER JOIN directory_projects p ON p.project_code = pm.project_code
      WHERE pm.uid = ? AND pm.status = 'active' AND (p.leader_uid IS NULL OR p.leader_uid <> ?) ${where}
      ORDER BY pm.joined_at DESC`,
    [uid, uid, ...params]
  )

  const managed = managedRows.map(normalizeProject)
  const joined = joinedRows.map(normalizeProject)

  return {
    managed,
    joined,
    items: [...managed, ...joined],
    total: managed.length + joined.length
  }
}

export async function listSubjectExports(query: DirectoryQuery = {}) {
  const params: unknown[] = []
  let sql = 'SELECT * FROM directory_subject_exports WHERE 1=1'

  const subjectType = String(query.subject_type || '').trim()
  if (subjectType) {
    sql += ' AND subject_type = ?'
    params.push(subjectType)
  }

  if (query.changed_after) {
    sql += ' AND updated_at > ?'
    params.push(query.changed_after)
  }

  if (query.cursor) {
    sql += ' AND id > ?'
    params.push(Number(query.cursor))
  }

  const limit = normalizeLimit(query.limit)
  sql += ' ORDER BY id ASC LIMIT ?'
  params.push(limit + 1)

  const rows = await queryRows<(SubjectExportRow & { id: number })[]>(sql, params)
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? String(pageRows[pageRows.length - 1]?.id || '') : null

  return {
    items: pageRows.map(row => ({
      subjectType: row.subject_type,
      subjectCode: row.subject_code,
      externalRef: row.external_ref,
      parentSubjectType: row.parent_subject_type,
      parentSubjectCode: row.parent_subject_code,
      sourceObjectType: row.source_object_type,
      sourceObjectCode: row.source_object_code,
      snapshotHash: row.snapshot_hash,
      status: row.status,
      exportedAt: row.exported_at,
      updatedAt: row.updated_at
    })),
    nextCursor,
    hasMore
  }
}

export async function listSubjectMemberships() {
  const rows = await queryRows<SubjectMembershipRow[]>(
    `SELECT ud.uid AS subject_code,
            ud.dept_code AS container_subject_code,
            d.org_type AS container_org_type,
            ud.relation_type,
            ud.is_primary,
            CASE
              WHEN ud.status = 'active'
               AND u.status = 'active'
               AND d.status = 'active'
              THEN 'active'
              ELSE 'inactive'
            END AS status,
            GREATEST(ud.updated_at, u.updated_at, d.updated_at) AS updated_at
       FROM directory_user_departments ud
       INNER JOIN directory_users u
         ON u.uid = ud.uid
       INNER JOIN directory_departments d
         ON d.dept_code = ud.dept_code
      WHERE ud.relation_type = 'member'
      ORDER BY ud.dept_code ASC, ud.uid ASC`
  )

  return rows.map(row => ({
    subjectType: 'user',
    subjectCode: row.subject_code,
    containerSubjectType: row.container_org_type === 'committee' ? 'committee' : 'department',
    containerSubjectCode: row.container_subject_code,
    relationType: row.relation_type,
    isPrimary: Boolean(row.is_primary),
    status: row.status,
    updatedAt: row.updated_at
  }))
}

export function ok<T>(data: T) {
  return { code: 0, data }
}
