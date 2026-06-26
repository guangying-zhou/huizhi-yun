/**
 * 服务端权限检查工具
 */
import type { H3Event } from 'h3'
import { appCode } from '~~/app/config/permissions'
import { ensureFinanceConsoleAuth, getRequestUid } from '~~/server/utils/authIdentity'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'

type AuthorizationResources = Record<string, string[]>
type PermissionAction = 'view' | 'edit' | 'approve' | 'confirm' | 'export' | 'admin'

async function loadAuthorizationResources(event: H3Event, uid: string): Promise<AuthorizationResources> {
  if (isDevPermissionBypassEnabled(event)) {
    return {
      dashboard: ['view', 'edit', 'admin'],
      invoices: ['view', 'edit', 'approve', 'admin'],
      receipts: ['view', 'edit', 'confirm', 'admin'],
      expenses: ['view', 'edit', 'approve', 'confirm', 'admin'],
      bank_accounts: ['view', 'edit', 'admin'],
      reconciliation: ['view', 'edit', 'confirm', 'admin'],
      project_accounting: ['view', 'edit', 'admin'],
      performance: ['view', 'edit', 'admin'],
      reports: ['view', 'export', 'admin'],
      settings: ['view', 'edit', 'admin']
    }
  }

  const bundleSnapshot = await loadAuthorizationSnapshotFromConsoleRuntime(uid, appCode, event)
  if (bundleSnapshot) {
    return bundleSnapshot.resources
  }

  return {}
}

function isDevPermissionBypassEnabled(event: H3Event) {
  const config = useRuntimeConfig(event) as {
    hzy?: {
      financeDevPermissions?: boolean
    }
  }
  return config.hzy?.financeDevPermissions === true
    || String(process.env.HZY_FINANCE_DEV_PERMISSIONS || '').toLowerCase() === 'true'
}

function hasServicePermission(event: H3Event, action: PermissionAction) {
  const consoleAuth = event.context.consoleAuth as {
    authenticated?: boolean
    tokenUse?: string
    subjectType?: string
    scopes?: string[]
  } | undefined

  if (!consoleAuth?.authenticated || consoleAuth.tokenUse !== 'service' || consoleAuth.subjectType !== 'service') {
    return false
  }

  const scopes = new Set(consoleAuth.scopes || [])
  if (scopes.has('finance:*') || scopes.has('finance:admin')) return true
  if (action === 'view') {
    return scopes.has('finance:read') || scopes.has('finance:invoices:read')
  }
  if (action === 'edit') {
    return scopes.has('finance:write') || scopes.has('finance:invoices:write')
  }
  return false
}

/**
 * 检查当前请求用户是否拥有指定权限
 */
export async function checkPermission(
  event: H3Event,
  resource: string,
  action: PermissionAction = 'admin'
): Promise<boolean> {
  if (isDevPermissionBypassEnabled(event)) return true
  await ensureFinanceConsoleAuth(event)
  if (hasServicePermission(event, action)) return true

  const uid = getRequestUid(event)
  if (!uid) return false

  try {
    const resources = await loadAuthorizationResources(event, uid)
    const actions: string[] = resources[resource] || []

    if (action === 'view') {
      return actions.includes('view') || actions.includes('edit') || actions.includes('admin')
    }
    if (action === 'edit') {
      return actions.includes('edit') || actions.includes('admin')
    }
    return actions.includes(action)
  } catch (error: unknown) {
    const err = error as { message?: string }
    console.error('[checkPermission] Failed:', err.message)
    return false
  }
}

/**
 * 要求指定权限，无权限时抛出 403 错误
 */
export async function requirePermission(
  event: H3Event,
  resource: string,
  action: PermissionAction = 'admin',
  message = '权限不足'
): Promise<void> {
  if (isDevPermissionBypassEnabled(event)) return
  await ensureFinanceConsoleAuth(event)
  if (hasServicePermission(event, action)) return

  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const allowed = await checkPermission(event, resource, action)
  if (!allowed) {
    throw createError({ statusCode: 403, message })
  }
}
