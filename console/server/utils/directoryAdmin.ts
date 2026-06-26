import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow, withTransaction } from '~~/server/utils/db'

type DirectoryUserStatus = 'active' | 'inactive' | 'pending' | 'deleted'
type DirectoryUserType = 'system' | 'employee' | 'external' | 'service'
type DirectoryGender = 'unknown' | 'male' | 'female'
type DirectoryProjectStatus = 'active' | 'inactive' | 'archived' | 'deleted'
type DirectoryProjectType = 'group' | 'project' | 'template'
type DirectoryProjectMemberRole = 'owner' | 'admin' | 'member' | 'viewer'
type DirectoryAuditActorType = 'human' | 'service' | 'system'

export interface DirectoryUserInput {
  uid?: unknown
  username?: unknown
  displayName?: unknown
  realName?: unknown
  nickname?: unknown
  avatarUrl?: unknown
  email?: unknown
  mobile?: unknown
  mobileTail4?: unknown
  positionTitle?: unknown
  gender?: unknown
  primaryDeptCode?: unknown
  userType?: unknown
  status?: unknown
  remark?: unknown
}

export interface DirectoryDepartmentInput {
  deptCode?: unknown
  name?: unknown
  deptName?: unknown
  parentDeptCode?: unknown
  managerId?: unknown
  leaderId?: unknown
  orgType?: unknown
  deptCategory?: unknown
  description?: unknown
  sortOrder?: unknown
  status?: unknown
}

export interface DirectoryProjectInput {
  projectCode?: unknown
  name?: unknown
  projectName?: unknown
  parentProjectCode?: unknown
  projectType?: unknown
  deptCode?: unknown
  ownerUid?: unknown
  leaderUid?: unknown
  repoUrl?: unknown
  description?: unknown
  status?: unknown
  memberUids?: unknown
  members?: unknown
}

interface DirectoryProjectMemberInput {
  uid?: unknown
  role?: unknown
}

interface CountRow extends RowDataPacket {
  count: number
}

interface UserRow extends RowDataPacket {
  uid: string
}

interface DepartmentRow extends RowDataPacket {
  id: number
  dept_code: string
  dept_name: string
  parent_dept_code: string | null
  dept_path: string | null
  level_no: number
}

interface ProjectRow extends RowDataPacket {
  project_code: string
  parent_project_code: string | null
}

function nullableString(value: unknown) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function requiredString(value: unknown, label: string) {
  const normalized = nullableString(value)
  if (!normalized) {
    throw createError({ statusCode: 400, message: `${label}不能为空` })
  }
  return normalized
}

function mobileTail4(mobile: string | null, explicitTail: string | null) {
  if (explicitTail) return explicitTail.slice(-4)
  return mobile ? mobile.slice(-4) : null
}

function normalizeStatus(value: unknown, fallback: DirectoryUserStatus): DirectoryUserStatus {
  const status = String(value || fallback).trim() as DirectoryUserStatus
  if (!['active', 'inactive', 'pending', 'deleted'].includes(status)) {
    throw createError({ statusCode: 400, message: '用户状态不合法' })
  }
  return status
}

function normalizeUserType(value: unknown, fallback: DirectoryUserType): DirectoryUserType {
  const userType = String(value || fallback).trim() as DirectoryUserType
  if (!['system', 'employee', 'external', 'service'].includes(userType)) {
    throw createError({ statusCode: 400, message: '用户类型不合法' })
  }
  return userType
}

function normalizeGender(value: unknown, fallback: DirectoryGender): DirectoryGender {
  const gender = String(value || fallback).trim() as DirectoryGender
  if (!['unknown', 'male', 'female'].includes(gender)) {
    throw createError({ statusCode: 400, message: '性别不合法' })
  }
  return gender
}

function normalizeDepartmentStatus(value: unknown, fallback: DirectoryUserStatus): DirectoryUserStatus {
  const status = String(value || fallback).trim() as DirectoryUserStatus
  if (!['active', 'inactive', 'deleted'].includes(status)) {
    throw createError({ statusCode: 400, message: '部门状态不合法' })
  }
  return status
}

function normalizeProjectStatus(value: unknown, fallback: DirectoryProjectStatus): DirectoryProjectStatus {
  const status = String(value || fallback).trim() as DirectoryProjectStatus
  if (!['active', 'inactive', 'archived', 'deleted'].includes(status)) {
    throw createError({ statusCode: 400, message: '项目状态不合法' })
  }
  return status
}

function normalizeProjectType(value: unknown): DirectoryProjectType {
  const projectType = String(value || 'project').trim() as DirectoryProjectType
  if (!['group', 'project', 'template'].includes(projectType)) {
    throw createError({ statusCode: 400, message: '项目类型不合法' })
  }
  return projectType
}

function normalizeMemberRole(value: unknown): DirectoryProjectMemberRole {
  const role = String(value || 'member').trim() as DirectoryProjectMemberRole
  if (!['owner', 'admin', 'member', 'viewer'].includes(role)) {
    throw createError({ statusCode: 400, message: '项目成员角色不合法' })
  }
  return role
}

function normalizeOrgType(value: unknown) {
  const orgType = String(value || 'department').trim()
  if (!['department', 'committee', 'virtual'].includes(orgType)) {
    throw createError({ statusCode: 400, message: '组织类型不合法' })
  }
  return orgType
}

function normalizeSortOrder(value: unknown) {
  const sortOrder = Number(value ?? 100)
  if (!Number.isFinite(sortOrder)) return 100
  return Math.trunc(sortOrder)
}

async function assertDepartmentExists(deptCode: string) {
  const row = await queryRow<CountRow>(
    'SELECT COUNT(*) AS count FROM directory_departments WHERE dept_code = ? AND status <> ?',
    [deptCode, 'deleted']
  )
  if (!Number(row?.count || 0)) {
    throw createError({ statusCode: 400, message: `主部门不存在：${deptCode}` })
  }
}

async function getDepartment(deptCode: string) {
  return queryRow<DepartmentRow>(
    `SELECT id, dept_code, dept_name, parent_dept_code, dept_path, level_no
       FROM directory_departments
      WHERE dept_code = ? AND status <> ?
      LIMIT 1`,
    [deptCode, 'deleted']
  )
}

async function assertUserExists(uid: string | null, label: string) {
  if (!uid) return
  const row = await queryRow<CountRow>(
    'SELECT COUNT(*) AS count FROM directory_users WHERE uid = ? AND status <> ?',
    [uid, 'deleted']
  )
  if (!Number(row?.count || 0)) {
    throw createError({ statusCode: 400, message: `${label}不存在：${uid}` })
  }
}

async function assertProjectExists(projectCode: string) {
  const row = await queryRow<CountRow>(
    'SELECT COUNT(*) AS count FROM directory_projects WHERE project_code = ? AND status <> ?',
    [projectCode, 'deleted']
  )
  if (!Number(row?.count || 0)) {
    throw createError({ statusCode: 400, message: `父项目不存在：${projectCode}` })
  }
}

async function getProject(projectCode: string) {
  return queryRow<ProjectRow>(
    `SELECT project_code, parent_project_code
       FROM directory_projects
      WHERE project_code = ? AND status <> ?
      LIMIT 1`,
    [projectCode, 'deleted']
  )
}

async function assertProjectParent(parentProjectCode: string | null, selfProjectCode?: string) {
  if (!parentProjectCode) return
  if (selfProjectCode && parentProjectCode === selfProjectCode) {
    throw createError({ statusCode: 400, message: '父项目不能是自身' })
  }
  await assertProjectExists(parentProjectCode)

  if (!selfProjectCode) return
  let current = await getProject(parentProjectCode)
  while (current?.parent_project_code) {
    if (current.parent_project_code === selfProjectCode) {
      throw createError({ statusCode: 400, message: '父项目不能是当前项目的子项目' })
    }
    current = await getProject(current.parent_project_code)
  }
}

async function resolveParent(parentDeptCode: string | null, selfDeptCode?: string) {
  if (!parentDeptCode) {
    return { parentId: null, parentDeptCode: null, deptPath: '/', levelNo: 1 }
  }

  if (selfDeptCode && parentDeptCode === selfDeptCode) {
    throw createError({ statusCode: 400, message: '父部门不能是自身' })
  }

  const parent = await getDepartment(parentDeptCode)
  if (!parent) {
    throw createError({ statusCode: 400, message: `父部门不存在：${parentDeptCode}` })
  }

  if (selfDeptCode) {
    let current: DepartmentRow | undefined | null = parent
    while (current?.parent_dept_code) {
      if (current.parent_dept_code === selfDeptCode) {
        throw createError({ statusCode: 400, message: '父部门不能是当前部门的子部门' })
      }
      current = await getDepartment(current.parent_dept_code)
    }
  }

  return {
    parentId: parent.id,
    parentDeptCode: parent.dept_code,
    deptPath: `${parent.dept_path || '/'}${parent.dept_code}/`,
    levelNo: Number(parent.level_no || 1) + 1
  }
}

async function writePrimaryDepartment(uid: string, deptCode: string | null) {
  if (!deptCode) {
    await execute<ResultSetHeader>(
      `UPDATE directory_user_departments
          SET is_primary = 0, updated_at = NOW()
        WHERE uid = ? AND relation_type = 'member'`,
      [uid]
    )
    return
  }

  await assertDepartmentExists(deptCode)
  await execute<ResultSetHeader>(
    `UPDATE directory_user_departments
        SET is_primary = 0, updated_at = NOW()
      WHERE uid = ? AND relation_type = 'member' AND dept_code <> ?`,
    [uid, deptCode]
  )
  await execute<ResultSetHeader>(
    `INSERT INTO directory_user_departments (
       uid, dept_code, relation_type, is_primary, source_provider, external_ref, status, created_at, updated_at
     ) VALUES (?, ?, 'member', 1, 'manual', ?, 'active', NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       is_primary = 1,
       status = 'active',
       left_at = NULL,
       updated_at = NOW()`,
    [uid, deptCode, `${uid}:${deptCode}:member`]
  )
}

async function writeDirectoryAudit(
  action: string,
  targetType: string,
  targetKey: string,
  actorUid: string,
  detail: Record<string, unknown>,
  actorType: DirectoryAuditActorType = 'human'
) {
  await execute<ResultSetHeader>(
    `INSERT INTO operation_logs (
       domain_code, action, target_type, target_key, actor_type, actor_id, detail_json, created_at
     ) VALUES ('directory', ?, ?, ?, ?, ?, CAST(? AS JSON), NOW())`,
    [action, targetType, targetKey, actorType, actorUid || null, JSON.stringify(detail)]
  )
}

export async function createDirectoryUser(input: DirectoryUserInput, actorUid: string) {
  const uid = requiredString(input.uid, 'uid')
  const realName = nullableString(input.realName)
  const displayName = nullableString(input.displayName) || realName || uid
  const mobile = nullableString(input.mobile)
  const primaryDeptCode = nullableString(input.primaryDeptCode)

  const existing = await queryRow<UserRow>('SELECT uid FROM directory_users WHERE uid = ? LIMIT 1', [uid])
  if (existing) {
    throw createError({ statusCode: 409, message: `用户已存在：${uid}` })
  }
  if (primaryDeptCode) {
    await assertDepartmentExists(primaryDeptCode)
  }

  await withTransaction(async (tx) => {
    await tx.execute<ResultSetHeader>(
      `INSERT INTO directory_users (
         uid, username, display_name, real_name, nickname, avatar_url, email, mobile, mobile_tail4,
         position_title, gender, primary_dept_code, user_type, source_provider, external_ref,
         synced_at, status, remark, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, NOW(), ?, ?, NOW(), NOW())`,
      [
        uid,
        nullableString(input.username),
        displayName,
        realName,
        nullableString(input.nickname),
        nullableString(input.avatarUrl),
        nullableString(input.email),
        mobile,
        mobileTail4(mobile, nullableString(input.mobileTail4)),
        nullableString(input.positionTitle),
        normalizeGender(input.gender, 'unknown'),
        primaryDeptCode,
        normalizeUserType(input.userType, 'employee'),
        uid,
        normalizeStatus(input.status, 'active'),
        nullableString(input.remark)
      ]
    )
  })

  await writePrimaryDepartment(uid, primaryDeptCode)
  await writeDirectoryAudit('directory.user.create', 'directory_user', uid, actorUid, { uid, primaryDeptCode })
}

export async function updateDirectoryUser(
  uid: string,
  input: DirectoryUserInput,
  actorUid: string,
  actorType: DirectoryAuditActorType = 'human'
) {
  const normalizedUid = requiredString(uid, 'uid')
  const existing = await queryRow<UserRow>('SELECT uid FROM directory_users WHERE uid = ? LIMIT 1', [normalizedUid])
  if (!existing) {
    throw createError({ statusCode: 404, message: `用户不存在：${normalizedUid}` })
  }

  const fields: string[] = []
  const params: unknown[] = []
  const setNullable = (field: string, value: unknown) => {
    fields.push(`${field} = ?`)
    params.push(nullableString(value))
  }
  const setValue = (field: string, value: unknown) => {
    fields.push(`${field} = ?`)
    params.push(value)
  }

  if ('username' in input) setNullable('username', input.username)
  if ('displayName' in input) setNullable('display_name', input.displayName)
  if ('realName' in input) setNullable('real_name', input.realName)
  if ('nickname' in input) setNullable('nickname', input.nickname)
  if ('avatarUrl' in input) setNullable('avatar_url', input.avatarUrl)
  if ('email' in input) setNullable('email', input.email)
  if ('mobile' in input) {
    const mobile = nullableString(input.mobile)
    setValue('mobile', mobile)
    setValue('mobile_tail4', mobileTail4(mobile, nullableString(input.mobileTail4)))
  } else if ('mobileTail4' in input) {
    setNullable('mobile_tail4', input.mobileTail4)
  }
  if ('positionTitle' in input) setNullable('position_title', input.positionTitle)
  if ('gender' in input) setValue('gender', normalizeGender(input.gender, 'unknown'))
  if ('userType' in input) setValue('user_type', normalizeUserType(input.userType, 'employee'))
  if ('status' in input) setValue('status', normalizeStatus(input.status, 'active'))
  if ('remark' in input) setNullable('remark', input.remark)

  const hasPrimaryDept = 'primaryDeptCode' in input
  const primaryDeptCode = hasPrimaryDept ? nullableString(input.primaryDeptCode) : undefined
  if (hasPrimaryDept && primaryDeptCode) {
    await assertDepartmentExists(primaryDeptCode)
  }
  if (hasPrimaryDept) {
    setValue('primary_dept_code', primaryDeptCode || null)
  }

  if (fields.length) {
    fields.push('source_provider = ?')
    params.push('manual')
    fields.push('synced_at = NOW()')
    fields.push('updated_at = NOW()')
    params.push(normalizedUid)
    await execute<ResultSetHeader>(
      `UPDATE directory_users SET ${fields.join(', ')} WHERE uid = ?`,
      params
    )
  }

  if (hasPrimaryDept) {
    await writePrimaryDepartment(normalizedUid, primaryDeptCode || null)
  }

  await writeDirectoryAudit('directory.user.update', 'directory_user', normalizedUid, actorUid, {
    uid: normalizedUid,
    changedFields: Object.keys(input)
  }, actorType)
}

export async function createDirectoryDepartment(input: DirectoryDepartmentInput, actorUid: string) {
  const deptCode = requiredString(input.deptCode, '部门编码')
  const deptName = requiredString(input.deptName ?? input.name, '部门名称')
  const parentDeptCode = nullableString(input.parentDeptCode)
  const managerId = nullableString(input.managerId)
  const leaderId = nullableString(input.leaderId)

  const existing = await getDepartment(deptCode)
  if (existing) {
    throw createError({ statusCode: 409, message: `部门已存在：${deptCode}` })
  }
  const parent = await resolveParent(parentDeptCode)
  await assertUserExists(managerId, '负责人')
  await assertUserExists(leaderId, 'Leader')

  await execute<ResultSetHeader>(
    `INSERT INTO directory_departments (
       dept_code, dept_name, parent_id, parent_dept_code, dept_path, level_no, sort_order,
       manager_uid, leader_uid, org_type, dept_category, description, source_provider,
       external_ref, synced_at, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, NOW(), ?, NOW(), NOW())`,
    [
      deptCode,
      deptName,
      parent.parentId,
      parent.parentDeptCode,
      parent.deptPath,
      parent.levelNo,
      normalizeSortOrder(input.sortOrder),
      managerId,
      leaderId,
      normalizeOrgType(input.orgType),
      nullableString(input.deptCategory),
      nullableString(input.description),
      deptCode,
      normalizeDepartmentStatus(input.status, 'active')
    ]
  )

  await writeDirectoryAudit('directory.department.create', 'directory_department', deptCode, actorUid, {
    deptCode,
    parentDeptCode
  })
}

export async function updateDirectoryDepartment(deptCode: string, input: DirectoryDepartmentInput, actorUid: string) {
  const normalizedDeptCode = requiredString(deptCode, '部门编码')
  const existing = await getDepartment(normalizedDeptCode)
  if (!existing) {
    throw createError({ statusCode: 404, message: `部门不存在：${normalizedDeptCode}` })
  }

  const fields: string[] = []
  const params: unknown[] = []
  const setNullable = (field: string, value: unknown) => {
    fields.push(`${field} = ?`)
    params.push(nullableString(value))
  }
  const setValue = (field: string, value: unknown) => {
    fields.push(`${field} = ?`)
    params.push(value)
  }

  if ('deptName' in input || 'name' in input) {
    setValue('dept_name', requiredString(input.deptName ?? input.name, '部门名称'))
  }
  if ('managerId' in input) {
    const managerId = nullableString(input.managerId)
    await assertUserExists(managerId, '负责人')
    setValue('manager_uid', managerId)
  }
  if ('leaderId' in input) {
    const leaderId = nullableString(input.leaderId)
    await assertUserExists(leaderId, 'Leader')
    setValue('leader_uid', leaderId)
  }
  if ('orgType' in input) setValue('org_type', normalizeOrgType(input.orgType))
  if ('deptCategory' in input) setNullable('dept_category', input.deptCategory)
  if ('description' in input) setNullable('description', input.description)
  if ('sortOrder' in input) setValue('sort_order', normalizeSortOrder(input.sortOrder))
  if ('status' in input) setValue('status', normalizeDepartmentStatus(input.status, 'active'))
  if ('parentDeptCode' in input) {
    const parent = await resolveParent(nullableString(input.parentDeptCode), normalizedDeptCode)
    setValue('parent_id', parent.parentId)
    setValue('parent_dept_code', parent.parentDeptCode)
    setValue('dept_path', parent.deptPath)
    setValue('level_no', parent.levelNo)
  }

  if (fields.length) {
    fields.push('source_provider = ?')
    params.push('manual')
    fields.push('synced_at = NOW()')
    fields.push('updated_at = NOW()')
    params.push(normalizedDeptCode)
    await execute<ResultSetHeader>(
      `UPDATE directory_departments SET ${fields.join(', ')} WHERE dept_code = ?`,
      params
    )
  }

  await writeDirectoryAudit('directory.department.update', 'directory_department', normalizedDeptCode, actorUid, {
    deptCode: normalizedDeptCode,
    changedFields: Object.keys(input)
  })
}

export async function deleteDirectoryDepartment(deptCode: string, actorUid: string) {
  const normalizedDeptCode = requiredString(deptCode, '部门编码')
  const existing = await getDepartment(normalizedDeptCode)
  if (!existing) {
    throw createError({ statusCode: 404, message: `部门不存在：${normalizedDeptCode}` })
  }

  const [children, members] = await Promise.all([
    queryRow<CountRow>(
      'SELECT COUNT(*) AS count FROM directory_departments WHERE parent_dept_code = ? AND status <> ?',
      [normalizedDeptCode, 'deleted']
    ),
    queryRow<CountRow>(
      'SELECT COUNT(*) AS count FROM directory_user_departments WHERE dept_code = ? AND status = ?',
      [normalizedDeptCode, 'active']
    )
  ])
  if (Number(children?.count || 0) > 0) {
    throw createError({ statusCode: 400, message: '该部门下有子部门，无法删除' })
  }
  if (Number(members?.count || 0) > 0) {
    throw createError({ statusCode: 400, message: '该部门下有成员，无法删除' })
  }

  await execute<ResultSetHeader>(
    `UPDATE directory_departments
        SET status = 'deleted', source_provider = 'manual', synced_at = NOW(), updated_at = NOW()
      WHERE dept_code = ?`,
    [normalizedDeptCode]
  )
  await writeDirectoryAudit('directory.department.delete', 'directory_department', normalizedDeptCode, actorUid, {
    deptCode: normalizedDeptCode
  })
}

function normalizeProjectMembers(input: DirectoryProjectInput) {
  const members = Array.isArray(input.members)
    ? input.members
    : Array.isArray(input.memberUids)
      ? input.memberUids.map(uid => ({ uid, role: 'member' }))
      : []

  const result: Array<{ uid: string, role: DirectoryProjectMemberRole }> = []
  const seen = new Set<string>()
  for (const raw of members as Array<DirectoryProjectMemberInput | string>) {
    const uid = typeof raw === 'string' ? nullableString(raw) : nullableString(raw.uid)
    if (!uid) continue
    const role = typeof raw === 'string' ? 'member' : normalizeMemberRole(raw.role)
    const key = `${uid}:${role}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ uid, role })
  }
  return result
}

export async function createDirectoryProject(input: DirectoryProjectInput, actorUid: string) {
  const projectCode = requiredString(input.projectCode, '项目编码')
  const projectName = requiredString(input.projectName ?? input.name, '项目名称')
  const parentProjectCode = nullableString(input.parentProjectCode)
  const deptCode = nullableString(input.deptCode)
  const ownerUid = nullableString(input.ownerUid)
  const leaderUid = nullableString(input.leaderUid)

  const existing = await getProject(projectCode)
  if (existing) {
    throw createError({ statusCode: 409, message: `项目已存在：${projectCode}` })
  }
  await assertProjectParent(parentProjectCode)
  if (deptCode) await assertDepartmentExists(deptCode)
  await assertUserExists(ownerUid, 'Owner')
  await assertUserExists(leaderUid, '负责人')

  await execute<ResultSetHeader>(
    `INSERT INTO directory_projects (
       project_code, parent_project_code, project_name, project_type, dept_code, owner_uid,
       leader_uid, repo_url, description, source_provider, external_ref, synced_at,
       status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, NOW(), ?, NOW(), NOW())`,
    [
      projectCode,
      parentProjectCode,
      projectName,
      normalizeProjectType(input.projectType),
      deptCode,
      ownerUid,
      leaderUid,
      nullableString(input.repoUrl),
      nullableString(input.description),
      projectCode,
      normalizeProjectStatus(input.status, 'active')
    ]
  )

  const members = normalizeProjectMembers(input)
  if (members.length) {
    await replaceDirectoryProjectMembers(projectCode, members, actorUid)
  }
  await writeDirectoryAudit('directory.project.create', 'directory_project', projectCode, actorUid, {
    projectCode,
    parentProjectCode,
    memberCount: members.length
  })
}

export async function updateDirectoryProject(projectCode: string, input: DirectoryProjectInput, actorUid: string) {
  const normalizedProjectCode = requiredString(projectCode, '项目编码')
  const existing = await getProject(normalizedProjectCode)
  if (!existing) {
    throw createError({ statusCode: 404, message: `项目不存在：${normalizedProjectCode}` })
  }

  const fields: string[] = []
  const params: unknown[] = []
  const setNullable = (field: string, value: unknown) => {
    fields.push(`${field} = ?`)
    params.push(nullableString(value))
  }
  const setValue = (field: string, value: unknown) => {
    fields.push(`${field} = ?`)
    params.push(value)
  }

  if ('projectName' in input || 'name' in input) {
    setValue('project_name', requiredString(input.projectName ?? input.name, '项目名称'))
  }
  if ('parentProjectCode' in input) {
    const parentProjectCode = nullableString(input.parentProjectCode)
    await assertProjectParent(parentProjectCode, normalizedProjectCode)
    setValue('parent_project_code', parentProjectCode)
  }
  if ('projectType' in input) setValue('project_type', normalizeProjectType(input.projectType))
  if ('deptCode' in input) {
    const deptCode = nullableString(input.deptCode)
    if (deptCode) await assertDepartmentExists(deptCode)
    setValue('dept_code', deptCode)
  }
  if ('ownerUid' in input) {
    const ownerUid = nullableString(input.ownerUid)
    await assertUserExists(ownerUid, 'Owner')
    setValue('owner_uid', ownerUid)
  }
  if ('leaderUid' in input) {
    const leaderUid = nullableString(input.leaderUid)
    await assertUserExists(leaderUid, '负责人')
    setValue('leader_uid', leaderUid)
  }
  if ('repoUrl' in input) setNullable('repo_url', input.repoUrl)
  if ('description' in input) setNullable('description', input.description)
  if ('status' in input) setValue('status', normalizeProjectStatus(input.status, 'active'))

  if (fields.length) {
    fields.push('source_provider = ?')
    params.push('manual')
    fields.push('synced_at = NOW()')
    fields.push('updated_at = NOW()')
    params.push(normalizedProjectCode)
    await execute<ResultSetHeader>(
      `UPDATE directory_projects SET ${fields.join(', ')} WHERE project_code = ?`,
      params
    )
  }

  if ('members' in input || 'memberUids' in input) {
    await replaceDirectoryProjectMembers(normalizedProjectCode, normalizeProjectMembers(input), actorUid)
  }

  await writeDirectoryAudit('directory.project.update', 'directory_project', normalizedProjectCode, actorUid, {
    projectCode: normalizedProjectCode,
    changedFields: Object.keys(input)
  })
}

export async function deleteDirectoryProject(projectCode: string, actorUid: string) {
  const normalizedProjectCode = requiredString(projectCode, '项目编码')
  const existing = await getProject(normalizedProjectCode)
  if (!existing) {
    throw createError({ statusCode: 404, message: `项目不存在：${normalizedProjectCode}` })
  }
  const children = await queryRow<CountRow>(
    'SELECT COUNT(*) AS count FROM directory_projects WHERE parent_project_code = ? AND status <> ?',
    [normalizedProjectCode, 'deleted']
  )
  if (Number(children?.count || 0) > 0) {
    throw createError({ statusCode: 400, message: '该项目下有子项目，无法删除' })
  }

  await withTransaction(async (tx) => {
    await tx.execute<ResultSetHeader>(
      `UPDATE directory_project_members
          SET status = 'deleted', left_at = NOW(), updated_at = NOW()
        WHERE project_code = ? AND status = 'active'`,
      [normalizedProjectCode]
    )
    await tx.execute<ResultSetHeader>(
      `UPDATE directory_projects
          SET status = 'deleted', source_provider = 'manual', synced_at = NOW(), updated_at = NOW()
        WHERE project_code = ?`,
      [normalizedProjectCode]
    )
  })

  await writeDirectoryAudit('directory.project.delete', 'directory_project', normalizedProjectCode, actorUid, {
    projectCode: normalizedProjectCode
  })
}

export async function replaceDirectoryProjectMembers(
  projectCode: string,
  members: Array<{ uid: string, role?: DirectoryProjectMemberRole }>,
  actorUid: string
) {
  const normalizedProjectCode = requiredString(projectCode, '项目编码')
  await assertProjectExists(normalizedProjectCode)

  const normalizedMembers = members
    .map(member => ({
      uid: requiredString(member.uid, '成员 UID'),
      role: normalizeMemberRole(member.role || 'member')
    }))

  for (const member of normalizedMembers) {
    await assertUserExists(member.uid, '成员')
  }

  await withTransaction(async (tx) => {
    await tx.execute<ResultSetHeader>(
      `UPDATE directory_project_members
          SET status = 'deleted', left_at = NOW(), updated_at = NOW()
        WHERE project_code = ? AND status = 'active'`,
      [normalizedProjectCode]
    )
    for (const member of normalizedMembers) {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO directory_project_members (
           project_code, uid, member_role, source_provider, external_ref, joined_at, left_at,
           status, created_at, updated_at
         ) VALUES (?, ?, ?, 'manual', ?, NOW(), NULL, 'active', NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           source_provider = 'manual',
           external_ref = VALUES(external_ref),
           left_at = NULL,
           status = 'active',
           updated_at = NOW()`,
        [normalizedProjectCode, member.uid, member.role, `${normalizedProjectCode}:${member.uid}:${member.role}`]
      )
    }
  })

  await writeDirectoryAudit('directory.project.members.update', 'directory_project', normalizedProjectCode, actorUid, {
    projectCode: normalizedProjectCode,
    memberCount: normalizedMembers.length,
    members: normalizedMembers
  })
}
