export const TENANT_CONSOLE_APP_CODE = 'tenant_console'

type TransactionExecutor = unknown

/**
 * Legacy compatibility shim.
 *
 * Earlier dashboard RBAC used an internal tenant_console namespace and seeded
 * tenant_console_owner/operator/viewer into platform_system_roles. Console is
 * now governed as the normal app_code='console' application, so this bootstrap
 * must not create any global system roles, templates, manifests, or tenant
 * roles. Keep the exported API temporarily because older tenant-admin routes
 * still import it while their UI is being retired.
 */
export async function ensureTenantConsoleGlobalSeeds(_tx: TransactionExecutor) {
  return {
    skipped: true,
    reason: 'tenant_console global seeds are deprecated; use app_code=console system roles'
  }
}

export async function bootstrapTenantConsoleRbac(_tx: TransactionExecutor, _tenantCode: string) {
  return {
    skipped: true,
    reason: 'tenant_console RBAC bootstrap is deprecated; use app_code=console system roles'
  }
}
