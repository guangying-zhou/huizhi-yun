import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { queryRow, queryRows, withTransaction } from '~~/server/utils/db'
import { expandActions } from './permissionActions'
import { resolveOpsPermission } from './platformOpsPermissionRoutes'

type TransactionExecutor = {
  queryRows: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<T>
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
  execute: <T extends ResultSetHeader>(sql: string, params?: unknown[]) => Promise<T>
}

type OpsResourceSeed = {
  code: string
  name: string
  description: string
  sortOrder: number
}

interface IdRow extends RowDataPacket {
  id: number
}

interface OpsRoleRow extends RowDataPacket {
  role_code: string
}

interface OpsPermissionRow extends RowDataPacket {
  resource_code: string
  action: string
}

export interface OpsAuthorizationSnapshot {
  uid: string
  roles: string[]
  resources: Record<string, string[]>
}

const OPS_RESOURCE_SEEDS: OpsResourceSeed[] = [
  { code: 'ops.console', name: '平台控制台', description: '平台运营后台总入口', sortOrder: 10 },
  { code: 'ops.tenants', name: '租户台账', description: '租户资料、开通状态与台账管理', sortOrder: 20 },
  { code: 'ops.applications', name: '应用台账', description: '平台应用目录与 manifest 管理', sortOrder: 30 },
  { code: 'ops.subscriptions', name: '订阅授权', description: '订阅、授权、开通闸门管理', sortOrder: 40 },
  { code: 'ops.deployments', name: '部署管理', description: '部署配置与连通性管理', sortOrder: 50 },
  { code: 'ops.licenses', name: '许可证管理', description: 'license 与 capability 管理', sortOrder: 60 },
  { code: 'ops.identities', name: '身份与目录', description: '用户、主体、身份映射管理', sortOrder: 70 },
  { code: 'ops.roles', name: '平台权限', description: '平台角色与权限矩阵管理', sortOrder: 80 },
  { code: 'ops.templates', name: '模板绑定', description: '模板、绑定、覆盖管理', sortOrder: 90 }
]

const OPS_SUPER_ADMIN_ROLE_CODE = 'ops_super_admin'
const OPS_AUDITOR_ROLE_CODE = 'ops_auditor'

const OPS_SUPER_ADMIN_ACTIONS_BY_RESOURCE: Record<string, string[]> = {
  'ops.subscriptions': ['view', 'edit', 'admin', 'confirm'],
  'ops.deployments': ['view', 'edit', 'admin', 'deploy']
}

let seedReadyKey = ''
let seedPromise: Promise<void> | null = null

function normalizeUid(value: string) {
  return String(value || '').trim()
}

function emptyOpsAuthorization(uid: string): OpsAuthorizationSnapshot {
  return {
    uid,
    roles: [],
    resources: {}
  }
}

function fullOpsAuthorization(uid: string): OpsAuthorizationSnapshot {
  return {
    uid,
    roles: [OPS_SUPER_ADMIN_ROLE_CODE],
    resources: Object.fromEntries(
      OPS_RESOURCE_SEEDS.map(resource => [resource.code, superAdminActionsForResource(resource.code)])
    )
  }
}

function superAdminActionsForResource(resourceCode: string) {
  return OPS_SUPER_ADMIN_ACTIONS_BY_RESOURCE[resourceCode] || ['view', 'edit', 'admin']
}

function appendResourceAction(resources: Record<string, string[]>, resourceCode: string, action: string) {
  const actions = resources[resourceCode] || []
  if (!actions.includes(action)) {
    actions.push(action)
  }
  resources[resourceCode] = actions
}

function buildActionCandidates(requiredAction: string): string[] {
  return expandActions(requiredAction)
}

async function ensurePlatformOpsSeeds(tx: TransactionExecutor) {
  for (const resource of OPS_RESOURCE_SEEDS) {
    await tx.execute<ResultSetHeader>(
      `INSERT INTO platform_resources
        (resource_code, resource_name, parent_id, description, sort_order, status, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, 'active', NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         resource_name = VALUES(resource_name),
         description = VALUES(description),
         sort_order = VALUES(sort_order),
         status = 'active',
         updated_at = NOW()`,
      [resource.code, resource.name, resource.description, resource.sortOrder]
    )
  }

  await tx.execute<ResultSetHeader>(
    `INSERT INTO platform_roles
      (role_code, role_name, description, is_builtin, is_assignable, status, created_at, updated_at)
     VALUES
      (?, 'Ops Super Admin', '平台运营超级管理员', 1, 0, 'active', NOW(), NOW()),
      (?, 'Ops Auditor', '平台运营只读审计员', 1, 1, 'active', NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       role_name = VALUES(role_name),
       description = VALUES(description),
       is_builtin = VALUES(is_builtin),
       is_assignable = VALUES(is_assignable),
       status = 'active',
       updated_at = NOW()`,
    [OPS_SUPER_ADMIN_ROLE_CODE, OPS_AUDITOR_ROLE_CODE]
  )

  const superRole = await tx.queryRow<IdRow>(
    `SELECT id FROM platform_roles WHERE role_code = ? LIMIT 1`,
    [OPS_SUPER_ADMIN_ROLE_CODE]
  )
  const auditorRole = await tx.queryRow<IdRow>(
    `SELECT id FROM platform_roles WHERE role_code = ? LIMIT 1`,
    [OPS_AUDITOR_ROLE_CODE]
  )

  if (!superRole || !auditorRole) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to resolve seeded platform roles'
    })
  }

  for (const resource of OPS_RESOURCE_SEEDS) {
    const resourceRow = await tx.queryRow<IdRow>(
      `SELECT id FROM platform_resources WHERE resource_code = ? LIMIT 1`,
      [resource.code]
    )

    if (!resourceRow) {
      continue
    }

    for (const action of superAdminActionsForResource(resource.code)) {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO platform_role_permissions
          (role_id, resource_id, action, created_at)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE action = VALUES(action)`,
        [superRole.id, resourceRow.id, action]
      )
    }

    await tx.execute<ResultSetHeader>(
      `INSERT INTO platform_role_permissions
        (role_id, resource_id, action, created_at)
       VALUES (?, ?, 'view', NOW())
       ON DUPLICATE KEY UPDATE action = VALUES(action)`,
      [auditorRole.id, resourceRow.id]
    )
  }
}

async function ensureOpsAccounts(tx: TransactionExecutor, bootstrapUids: string[]) {
  if (!bootstrapUids.length) {
    return
  }

  const superRole = await tx.queryRow<IdRow>(
    `SELECT id FROM platform_roles WHERE role_code = ? LIMIT 1`,
    [OPS_SUPER_ADMIN_ROLE_CODE]
  )

  if (!superRole) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'ops super admin role is missing'
    })
  }

  for (const uid of bootstrapUids) {
    const normalizedUid = normalizeUid(uid)
    if (!normalizedUid) {
      continue
    }

    const username = normalizedUid.toLowerCase()
    const email = `${username}@local.platform`
    const displayName = normalizedUid

    await tx.execute<ResultSetHeader>(
      `INSERT INTO platform_accounts
        (uid, account_type, username, email, display_name, password_hash, oidc_sub, mfa_enabled, status, created_at, updated_at)
       VALUES (?, 'staff', ?, ?, ?, NULL, NULL, 0, 'active', NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         account_type = 'staff',
         status = 'active',
         updated_at = NOW()`,
      [normalizedUid, username, email, displayName]
    )

    const account = await tx.queryRow<IdRow>(
      `SELECT id FROM platform_accounts WHERE uid = ? LIMIT 1`,
      [normalizedUid]
    )

    if (!account) {
      continue
    }

    await tx.execute<ResultSetHeader>(
      `INSERT INTO platform_account_roles
        (account_id, role_id, granted_by_account_id, granted_at, expired_at)
       VALUES (?, ?, NULL, NOW(), NULL)
       ON DUPLICATE KEY UPDATE expired_at = NULL`,
      [account.id, superRole.id]
    )
  }
}

export async function ensureOpsRbacReady(bootstrapUids: string[]) {
  const normalizedBootstrapUids = [...new Set(bootstrapUids.map(normalizeUid).filter(Boolean))].sort()
  const currentKey = normalizedBootstrapUids.join(',')

  if (seedReadyKey === currentKey) {
    return
  }

  if (seedPromise) {
    await seedPromise
    if (seedReadyKey === currentKey) {
      return
    }
  }

  seedPromise = withTransaction(async (tx) => {
    await ensurePlatformOpsSeeds(tx)
    await ensureOpsAccounts(tx, normalizedBootstrapUids)
  }).then(() => {
    seedReadyKey = currentKey
  }).finally(() => {
    seedPromise = null
  })

  await seedPromise
}

export async function grantOpsSuperAdminRoleToAccount(accountId: number) {
  if (!Number.isFinite(accountId) || accountId <= 0) {
    return
  }

  await withTransaction(async (tx) => {
    await ensurePlatformOpsSeeds(tx)

    const superRole = await tx.queryRow<IdRow>(
      `SELECT id FROM platform_roles WHERE role_code = ? LIMIT 1`,
      [OPS_SUPER_ADMIN_ROLE_CODE]
    )

    if (!superRole) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Internal Server Error',
        message: 'ops super admin role is missing'
      })
    }

    await tx.execute<ResultSetHeader>(
      `INSERT INTO platform_account_roles
        (account_id, role_id, granted_by_account_id, granted_at, expired_at)
       VALUES (?, ?, NULL, NOW(), NULL)
       ON DUPLICATE KEY UPDATE expired_at = NULL`,
      [accountId, superRole.id]
    )
  })
}

export async function hasOpsPermission(uid: string, path: string, method: string) {
  const normalizedUid = normalizeUid(uid)
  if (!normalizedUid) {
    return false
  }

  const { resourceCode, requiredAction } = resolveOpsPermission(path, method)
  const actions = buildActionCandidates(requiredAction)
  const placeholders = actions.map(() => '?').join(', ')

  const granted = await queryRow<RowDataPacket>(
    `SELECT 1
     FROM platform_accounts pa
     INNER JOIN platform_account_roles par
       ON par.account_id = pa.id
      AND (par.expired_at IS NULL OR par.expired_at > NOW())
     INNER JOIN platform_roles pr
       ON pr.id = par.role_id
      AND pr.status = 'active'
     INNER JOIN platform_role_permissions prp
       ON prp.role_id = pr.id
     INNER JOIN platform_resources pres
       ON pres.id = prp.resource_id
      AND pres.status = 'active'
     WHERE pa.uid = ?
       AND pa.status = 'active'
       AND pres.resource_code = ?
       AND prp.action IN (${placeholders})
     LIMIT 1`,
    [normalizedUid, resourceCode, ...actions]
  )

  return Boolean(granted)
}

export async function buildOpsAuthorizationSnapshot(
  uid: string,
  options: {
    bootstrapUids?: string[]
    fallbackFullAccess?: boolean
  } = {}
): Promise<OpsAuthorizationSnapshot> {
  const normalizedUid = normalizeUid(uid)
  if (!normalizedUid) {
    return emptyOpsAuthorization('')
  }

  await ensureOpsRbacReady(options.bootstrapUids || [])

  const roleRows = await queryRows<OpsRoleRow[]>(
    `SELECT DISTINCT pr.role_code
     FROM platform_accounts pa
     INNER JOIN platform_account_roles par
       ON par.account_id = pa.id
      AND (par.expired_at IS NULL OR par.expired_at > NOW())
     INNER JOIN platform_roles pr
       ON pr.id = par.role_id
      AND pr.status = 'active'
     WHERE pa.uid = ?
       AND pa.status = 'active'
     ORDER BY pr.role_code`,
    [normalizedUid]
  )

  const permissionRows = await queryRows<OpsPermissionRow[]>(
    `SELECT DISTINCT pres.resource_code, prp.action
     FROM platform_accounts pa
     INNER JOIN platform_account_roles par
       ON par.account_id = pa.id
      AND (par.expired_at IS NULL OR par.expired_at > NOW())
     INNER JOIN platform_roles pr
       ON pr.id = par.role_id
      AND pr.status = 'active'
     INNER JOIN platform_role_permissions prp
       ON prp.role_id = pr.id
     INNER JOIN platform_resources pres
       ON pres.id = prp.resource_id
      AND pres.status = 'active'
     WHERE pa.uid = ?
       AND pa.status = 'active'
     ORDER BY pres.resource_code, prp.action`,
    [normalizedUid]
  )

  if (!roleRows.length && options.fallbackFullAccess) {
    return fullOpsAuthorization(normalizedUid)
  }

  const resources: Record<string, string[]> = {}
  for (const permission of permissionRows) {
    appendResourceAction(resources, permission.resource_code, permission.action)
  }

  return {
    uid: normalizedUid,
    roles: roleRows.map(role => role.role_code),
    resources
  }
}
