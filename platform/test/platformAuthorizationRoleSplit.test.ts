import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

function workspaceSource(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

function workspaceRoot(path = '') {
  return new URL(`../../${path}`, import.meta.url)
}

function platformSource(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

type ManifestRole = {
  code?: string
  suggestedPermissions?: string[]
}

type ManifestAction = string | {
  action?: string
  code?: string
  actionCode?: string
}

type ManifestResource = {
  code?: string
  actions?: ManifestAction[]
}

type SeedAppRoleMap = {
  roleCode: string
  appRoleCode: string
  sortOrder: number
}

const manifestAppCodes = [
  'aims',
  'altoc',
  'assets',
  'codocs',
  'collab',
  'console',
  'enterprise',
  'finance',
  'insights',
  'people',
  'platform',
  'webdev',
  'workflow'
]

function discoverWorkspaceManifestAppCodes() {
  return readdirSync(workspaceRoot(), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(appCode => appCode !== 'account')
    .filter(appCode => existsSync(workspaceRoot(`${appCode}/app.manifest.json`)))
    .sort()
}

const sensitiveManifestActions = new Set([
  'approve',
  'issue',
  'confirm',
  'export',
  'deploy',
  'reject',
  'delegate',
  'cancel',
  'resubmit',
  'close',
  'archive',
  'publish',
  'delete',
  'admin',
  'trigger',
  'simulate-role',
  'simulate-user',
  'release',
  'rotate',
  'reveal',
  'retry'
])

function parseSeedAppRoleMaps(seed: string): SeedAppRoleMap[] {
  return [...seed.matchAll(/\('([^']+)',\s*'([^']+:[^']+)',\s*(\d+)\)/g)].map(match => ({
    roleCode: match[1],
    appRoleCode: match[2],
    sortOrder: Number(match[3])
  }))
}

function manifestRoleCodes(appCode: string) {
  const manifest = JSON.parse(workspaceSource(`${appCode}/app.manifest.json`)) as { recommendedRoles?: ManifestRole[] }
  return new Set((manifest.recommendedRoles || []).map(role => role.code).filter(Boolean))
}

function normalizeManifestAction(action: ManifestAction) {
  return typeof action === 'string' ? action : (action.action || action.code || action.actionCode)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function manifestResourceActions(appCode: string) {
  const manifest = JSON.parse(workspaceSource(`${appCode}/app.manifest.json`)) as { resources?: ManifestResource[] }
  const resourceActions = new Map<string, Set<string>>()

  for (const resource of manifest.resources || []) {
    if (!resource.code) {
      continue
    }
    resourceActions.set(
      resource.code,
      new Set((resource.actions || []).map(normalizeManifestAction).filter(isNonEmptyString))
    )
  }

  return resourceActions
}

function manifestRolePermissions(appCode: string) {
  const manifest = JSON.parse(workspaceSource(`${appCode}/app.manifest.json`)) as { recommendedRoles?: ManifestRole[] }
  return new Map((manifest.recommendedRoles || []).map(role => [role.code, role.suggestedPermissions || []]))
}

describe('Platform authorization role split', () => {
  test('sensitive role audits cover every non-legacy workspace app manifest', () => {
    assert.deepEqual(manifestAppCodes, discoverWorkspaceManifestAppCodes())
  })

  test('authorization admin does not include role or user simulation permissions', () => {
    const manifest = JSON.parse(platformSource('app.manifest.json')) as { recommendedRoles?: ManifestRole[] }
    const roles = manifest.recommendedRoles || []
    const authorizationAdmin = roles.find(role => role.code === 'platform:authorization_admin')
    const authorizationSimulator = roles.find(role => role.code === 'platform:authorization_simulator')

    assert.ok(authorizationAdmin)
    assert.ok(authorizationSimulator)
    assert.deepEqual(authorizationAdmin.suggestedPermissions, [
      'platform:authorization:view',
      'platform:authorization:admin'
    ])
    assert.deepEqual(authorizationSimulator.suggestedPermissions, [
      'platform:authorization:view',
      'platform:authorization:simulate-role',
      'platform:authorization:simulate-user'
    ])
  })

  test('system admin seed composes both authorization admin and simulator roles', () => {
    const seed = workspaceSource('platform/docs/sql/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql')

    assert.match(seed, /\('system_admin', 'platform:authorization_admin', 5\)/)
    assert.match(seed, /\('system_admin', 'platform:authorization_simulator', 6\)/)
  })

  test('P0 enterprise role mappings stay on the audited least-privilege composition', () => {
    const seed = workspaceSource('platform/docs/sql/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql')
    const mappings = parseSeedAppRoleMaps(seed)
    const mappingsFor = (roleCode: string) => mappings
      .filter(mapping => mapping.roleCode === roleCode)
      .map(mapping => mapping.appRoleCode)
      .sort()

    assert.deepEqual(mappingsFor('general_manager'), [
      'aims:viewer',
      'altoc:viewer',
      'assets:viewer',
      'codocs:viewer',
      'console:viewer',
      'finance:viewer',
      'insights:viewer',
      'people:viewer',
      'workflow:approver',
      'workflow:viewer'
    ])
    assert.deepEqual(mappingsFor('project_director'), [
      'aims:pmo',
      'aims:project_approver',
      'aims:project_director',
      'aims:viewer',
      'codocs:viewer',
      'insights:analyst',
      'insights:report_exporter',
      'workflow:approver'
    ])
    assert.deepEqual(mappingsFor('hr_director'), [
      'codocs:viewer',
      'console:directory_operator',
      'people:approver',
      'people:manager',
      'workflow:approver'
    ])
    assert.deepEqual(mappingsFor('hr_specialist'), [
      'codocs:editor',
      'people:specialist',
      'workflow:approver'
    ])
    assert.deepEqual(mappingsFor('department_manager'), [
      'assets:owner',
      'finance:expense_approver',
      'workflow:approver'
    ])
    assert.deepEqual(mappingsFor('procurement_asset_manager'), [
      'assets:inventory_manager',
      'assets:procurement',
      'assets:viewer',
      'finance:viewer',
      'workflow:approver'
    ])
  })

  test('enterprise role seed references app roles that exist in current manifests', () => {
    const seed = workspaceSource('platform/docs/sql/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql')
    const appRoleMaps = parseSeedAppRoleMaps(seed)
    const roleCodesByApp = new Map<string, Set<string>>()

    for (const { appRoleCode } of appRoleMaps) {
      const appCode = appRoleCode.split(':')[0]
      if (!roleCodesByApp.has(appCode)) {
        roleCodesByApp.set(appCode, manifestRoleCodes(appCode))
      }
      assert.equal(
        roleCodesByApp.get(appCode)!.has(appRoleCode),
        true,
        `missing app role ${appRoleCode} in ${appCode}/app.manifest.json`
      )
    }
  })

  test('application manifest recommended role permissions reference declared resource actions', () => {
    const missingPermissions = manifestAppCodes.flatMap((appCode) => {
      const actionsByResource = manifestResourceActions(appCode)
      return [...manifestRolePermissions(appCode).entries()].flatMap(([roleCode, permissions]) => {
        if (!roleCode) {
          return []
        }

        return permissions.flatMap((permission) => {
          const [permissionAppCode, resourceCode, ...actionParts] = permission.split(':')
          const action = actionParts.join(':')
          const permissionLabel = `${appCode}|${roleCode}|${permission}`

          if (!permissionAppCode || !resourceCode || !action) {
            return [`${permissionLabel}|malformed permission`]
          }
          if (permissionAppCode !== appCode) {
            return [`${permissionLabel}|wrong app prefix`]
          }

          const resourceActions = actionsByResource.get(resourceCode)
          if (!resourceActions) {
            return [`${permissionLabel}|missing resource`]
          }
          if (!resourceActions.has(action)) {
            return [`${permissionLabel}|missing action`]
          }

          return []
        })
      })
    }).sort()

    assert.deepEqual(missingPermissions, [])
  })

  test('non-system default enterprise roles do not include application admin roles', () => {
    const seed = workspaceSource('platform/docs/sql/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql')
    const overWideMappings = parseSeedAppRoleMaps(seed)
      .filter(({ roleCode }) => roleCode !== 'system_admin')
      .filter(({ appRoleCode }) => appRoleCode.endsWith(':admin'))

    assert.deepEqual(overWideMappings, [])
  })

  test('application manifest non-admin role sensitive permissions stay explicitly allowlisted', () => {
    const allowedManifestSensitivePermissions = [
      'aims|aims:pm|aims:projects:close',
      'aims|aims:pm|aims:reports:export',
      'aims|aims:pm|aims:timesheet:approve',
      'aims|aims:pm|aims:work_items:confirm',
      'aims|aims:pm|aims:work_items:delete',
      'aims|aims:product_director|aims:product_objectives:archive',
      'aims|aims:product_director|aims:product_objectives:close',
      'aims|aims:product_director|aims:product_versions:archive',
      'aims|aims:product_director|aims:products:admin',
      'aims|aims:product_director|aims:products:archive',
      'aims|aims:product_manager|aims:product_components:delete',
      'aims|aims:product_manager|aims:product_features:delete',
      'aims|aims:product_manager|aims:product_objectives:archive',
      'aims|aims:product_manager|aims:product_objectives:close',
      'aims|aims:product_manager|aims:product_requests:delete',
      'aims|aims:product_manager|aims:product_versions:archive',
      'aims|aims:product_manager|aims:product_versions:delete',
      'aims|aims:product_manager|aims:products:admin',
      'aims|aims:product_manager|aims:products:archive',
      'aims|aims:product_publisher|aims:product_versions:publish',
      'aims|aims:pmo|aims:portfolios:admin',
      'aims|aims:pmo|aims:projects:close',
      'aims|aims:pmo|aims:reports:export',
      'aims|aims:pmo|aims:timesheet:approve',
      'aims|aims:project_approver|aims:projects:approve',
      'aims|aims:project_director|aims:project_templates:admin',
      'aims|aims:project_director|aims:projects:admin',
      'aims|aims:project_director|aims:weekly_reports:export',
      'aims|aims:project_director|aims:weekly_reports:publish',
      'altoc|altoc:contract_approver|altoc:contract:approve',
      'altoc|altoc:contract_approver|altoc:customer:approve',
      'altoc|altoc:contract_approver|altoc:quotation:approve',
      'altoc|altoc:contract_manager|altoc:dashboard:export',
      'altoc|altoc:contract_manager|altoc:receivable:confirm',
      'altoc|altoc:customer_success|altoc:service_ticket:close',
      'assets|assets:asset_approver|assets:asset_items:approve',
      'assets|assets:asset_approver|assets:assignments:approve',
      'assets|assets:asset_approver|assets:purchase_orders:approve',
      'codocs|codocs:publisher|codocs:company:publish',
      'codocs|codocs:publisher|codocs:departments:export',
      'codocs|codocs:publisher|codocs:reviews:approve',
      'codocs|codocs:publisher|codocs:reviews:archive',
      'codocs|codocs:records_manager|codocs:departments:export',
      'codocs|codocs:records_manager|codocs:documents:export',
      'codocs|codocs:records_manager|codocs:projects:export',
      'codocs|codocs:records_manager|codocs:reviews:archive',
      'codocs|codocs:space_admin|codocs:company:admin',
      'codocs|codocs:space_admin|codocs:departments:admin',
      'codocs|codocs:space_admin|codocs:documents:admin',
      'codocs|codocs:space_admin|codocs:info:admin',
      'codocs|codocs:space_admin|codocs:projects:admin',
      'console|console:directory_manager|console:directory_departments:admin',
      'console|console:directory_manager|console:directory_projects:admin',
      'console|console:directory_manager|console:directory_sources:admin',
      'console|console:directory_manager|console:directory_sync:admin',
      'console|console:directory_manager|console:directory_sync:export',
      'console|console:directory_manager|console:directory_users:admin',
      'console|console:directory_operator|console:directory_departments:admin',
      'console|console:directory_operator|console:directory_projects:admin',
      'console|console:directory_operator|console:directory_users:admin',
      'console|console:security_admin|console:authorization_lifecycle:admin',
      'console|console:security_admin|console:collab_runtime:admin',
      'console|console:security_admin|console:credential_vault:admin',
      'console|console:security_admin|console:data_runtime:admin',
      'console|console:security_admin|console:data_runtime:deploy',
      'console|console:security_admin|console:integration_config:admin',
      'console|console:security_admin|console:runtime_apps:admin',
      'console|console:security_admin|console:service_clients:admin',
      'console|console:security_admin|console:system_settings:admin',
      'finance|finance:ar_accountant|finance:invoices:issue',
      'finance|finance:cashier|finance:expenses:confirm',
      'finance|finance:cashier|finance:receipts:confirm',
      'finance|finance:expense_approver|finance:expenses:approve',
      'finance|finance:invoice_approver|finance:invoices:approve',
      'finance|finance:manager|finance:bank_accounts:admin',
      'finance|finance:manager|finance:dashboard:export',
      'finance|finance:manager|finance:expenses:admin',
      'finance|finance:manager|finance:invoices:admin',
      'finance|finance:manager|finance:performance:admin',
      'finance|finance:manager|finance:project_accounting:admin',
      'finance|finance:manager|finance:receipts:admin',
      'finance|finance:manager|finance:reconciliation:admin',
      'finance|finance:manager|finance:reports:export',
      'finance|finance:reconciliation_operator|finance:reconciliation:confirm',
      'finance|finance:report_viewer|finance:dashboard:export',
      'finance|finance:report_viewer|finance:reports:export',
      'insights|insights:ingestion_operator|insights:repo_ingestion:trigger',
      'insights|insights:monitoring_admin|insights:monitoring:admin',
      'insights|insights:repository_admin|insights:repo_ingestion:admin',
      'insights|insights:repository_admin|insights:repos:admin',
      'insights|insights:report_exporter|insights:dashboard:export',
      'insights|insights:settings_admin|insights:insights_settings:admin',
      'people|people:approver|people:assignments:approve',
      'people|people:approver|people:cost_snapshots:approve',
      'people|people:approver|people:performance_cycles:approve',
      'people|people:compensation_admin|people:cost_snapshots:admin',
      'people|people:compensation_admin|people:standard_costs:admin',
      'people|people:department_manager|people:offboarding_tasks:confirm',
      'people|people:directory_admin|people:admin:admin',
      'people|people:directory_admin|people:documents:admin',
      'people|people:directory_admin|people:employees:admin',
      'people|people:directory_admin|people:positions:admin',
      'people|people:directory_admin|people:ranks:admin',
      'people|people:employee|people:offboarding_tasks:confirm',
      'people|people:manager|people:assignments:admin',
      'people|people:manager|people:employees:admin',
      'people|people:manager|people:offboarding_tasks:admin',
      'people|people:manager|people:offboarding_tasks:cancel',
      'people|people:manager|people:offboarding_tasks:confirm',
      'people|people:performance_manager|people:performance_cycles:admin',
      'people|people:specialist|people:offboarding_tasks:cancel',
      'platform|platform:authorization_admin|platform:authorization:admin',
      'platform|platform:authorization_simulator|platform:authorization:simulate-role',
      'platform|platform:authorization_simulator|platform:authorization:simulate-user',
      'webdev|webdev:deployer|webdev:webdev_workspace:deploy',
      'workflow|workflow:approver|workflow:workflow_tasks:approve',
      'workflow|workflow:approver|workflow:workflow_tasks:delegate',
      'workflow|workflow:approver|workflow:workflow_tasks:reject',
      'workflow|workflow:initiator|workflow:workflow_instances:cancel',
      'workflow|workflow:initiator|workflow:workflow_instances:resubmit'
    ]

    const actualManifestSensitivePermissions = manifestAppCodes.flatMap((appCode) => {
      const rolePermissions = manifestRolePermissions(appCode)
      return [...rolePermissions.entries()]
        .filter(([roleCode]) => roleCode && !roleCode.endsWith(':admin'))
        .flatMap(([roleCode, permissions]) => permissions
          .filter((permission) => {
            const action = permission.split(':').slice(2).join(':')
            return sensitiveManifestActions.has(action)
          })
          .map(permission => `${appCode}|${roleCode}|${permission}`))
    }).sort()

    assert.deepEqual(actualManifestSensitivePermissions, allowedManifestSensitivePermissions.sort())
  })

  test('application manifest non-admin role business workflow permissions stay explicitly allowlisted', () => {
    const workflowActions = new Set([
      'assign',
      'convert',
      'disqualify',
      'transition',
      'submit',
      'execute',
      'activity',
      'delivery-result:sync',
      'finance-summary:sync',
      'mark-billable'
    ])
    const allowedManifestWorkflowPermissions = [
      'aims|aims:dev|aims:timesheet:submit',
      'aims|aims:member|aims:timesheet:submit',
      'aims|aims:pm|aims:timesheet:submit',
      'aims|aims:pm|aims:weekly_reports:submit',
      'aims|aims:pm|aims:work_items:assign',
      'altoc|altoc:sales|altoc:lead:activity',
      'altoc|altoc:sales|altoc:lead:assign',
      'altoc|altoc:sales|altoc:lead:convert',
      'altoc|altoc:sales|altoc:lead:disqualify',
      'altoc|altoc:sales|altoc:opportunity:activity',
      'altoc|altoc:sales|altoc:opportunity:assign',
      'altoc|altoc:sales|altoc:opportunity:transition',
      'codocs|codocs:editor|codocs:reviews:submit',
      'webdev|webdev:deployer|webdev:webdev_workspace:execute',
      'webdev|webdev:operator|webdev:webdev_workspace:execute'
    ]

    const actualManifestWorkflowPermissions = manifestAppCodes.flatMap((appCode) => {
      const rolePermissions = manifestRolePermissions(appCode)
      return [...rolePermissions.entries()]
        .filter(([roleCode]) => roleCode && !roleCode.endsWith(':admin'))
        .flatMap(([roleCode, permissions]) => permissions
          .filter((permission) => {
            const action = permission.split(':').slice(2).join(':')
            return workflowActions.has(action)
          })
          .map(permission => `${appCode}|${roleCode}|${permission}`))
    }).sort()

    assert.deepEqual(actualManifestWorkflowPermissions, allowedManifestWorkflowPermissions.sort())
  })

  test('non-system default enterprise roles do not include high-risk add-on app roles', () => {
    const seed = workspaceSource('platform/docs/sql/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql')
    const restrictedAppRoles = new Set([
      'platform:authorization_simulator',
      'console:operator',
      'console:directory_manager',
      'console:security_admin',
      'webdev:deployer',
      'webdev:admin',
      'finance:cashier',
      'finance:reconciliation_operator',
      'people:performance_manager',
      'people:compensation_admin',
      'people:directory_admin',
      'assets:asset_approver',
      'codocs:publisher',
      'insights:contributor_manager',
      'insights:ingestion_operator',
      'insights:monitoring_operator',
      'insights:monitoring_admin',
      'insights:repository_admin',
      'insights:settings_admin'
    ])
    const overWideMappings = parseSeedAppRoleMaps(seed)
      .filter(({ roleCode }) => roleCode !== 'system_admin')
      .filter(({ appRoleCode }) => restrictedAppRoles.has(appRoleCode))

    assert.deepEqual(overWideMappings, [])
  })

  test('enterprise role seed fails closed on over-wide non-system default app-role mappings', () => {
    const seed = workspaceSource('platform/docs/sql/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql')

    assert.match(seed, /tmp_platform_restricted_default_app_role_seed/)
    assert.match(seed, /non_system_admin_app_role/)
    assert.match(seed, /non_system_admin_app_roles/)
    assert.match(seed, /restricted_default_app_roles/)
    assert.match(seed, /m\.role_code <> 'system_admin'[\s\S]{0,120}m\.app_role_code LIKE '%:admin'/)
    assert.match(seed, /INNER JOIN `tmp_platform_restricted_default_app_role_seed` r[\s\S]{0,220}m\.role_code <> 'system_admin'/)
    assert.match(seed, /platform:authorization_simulator/)
    assert.match(seed, /finance:cashier/)
    assert.match(seed, /assets:asset_approver/)
    assert.match(seed, /insights:settings_admin/)
  })

  test('non-system default enterprise roles do not expand to high-risk add-on permissions', () => {
    const seed = workspaceSource('platform/docs/sql/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql')
    const restrictedPermissions = new Set([
      'platform:authorization:simulate-role',
      'platform:authorization:simulate-user',
      'console:directory_sources:admin',
      'console:directory_sync:admin',
      'console:directory_sync:export',
      'console:system_settings:admin',
      'console:integration_config:admin',
      'console:credential_vault:admin',
      'console:service_clients:admin',
      'console:data_runtime:deploy',
      'console:data_runtime:admin',
      'console:runtime_apps:admin',
      'console:authorization_lifecycle:admin',
      'console:collab_runtime:admin',
      'webdev:webdev_workspace:deploy',
      'webdev:webdev_workspace:admin',
      'finance:receipts:confirm',
      'finance:expenses:confirm',
      'finance:reconciliation:confirm',
      'people:performance_cycles:admin',
      'people:standard_costs:admin',
      'people:documents:admin',
      'people:positions:admin',
      'people:ranks:admin',
      'people:admin:admin',
      'assets:purchase_orders:approve',
      'assets:assignments:approve',
      'codocs:reviews:approve',
      'codocs:reviews:archive',
      'codocs:company:publish',
      'insights:repo_ingestion:trigger',
      'insights:contributors:edit',
      'insights:monitoring:edit',
      'insights:monitoring:admin',
      'insights:repos:admin',
      'insights:repo_ingestion:admin',
      'insights:insights_settings:admin'
    ])
    const allowedDefaultSensitivePermissions = new Set([
      'records_manager|codocs:records_manager|codocs:reviews:archive'
    ])
    const permissionsByAppRole = new Map<string, string[]>()
    const expandedRestrictedPermissions = parseSeedAppRoleMaps(seed)
      .filter(({ roleCode }) => roleCode !== 'system_admin')
      .flatMap(({ roleCode, appRoleCode }) => {
        if (!permissionsByAppRole.has(appRoleCode)) {
          const appCode = appRoleCode.split(':')[0]
          permissionsByAppRole.set(appRoleCode, manifestRolePermissions(appCode).get(appRoleCode) || [])
        }
        return permissionsByAppRole.get(appRoleCode)!
          .filter(permission => restrictedPermissions.has(permission))
          .map(permission => ({ roleCode, appRoleCode, permission }))
      })
      .filter(({ roleCode, appRoleCode, permission }) =>
        !allowedDefaultSensitivePermissions.has(`${roleCode}|${appRoleCode}|${permission}`)
      )

    assert.deepEqual(expandedRestrictedPermissions, [])
  })

  test('non-system default enterprise role approve confirm export deploy grants stay explicitly allowlisted', () => {
    const seed = workspaceSource('platform/docs/sql/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql')
    const sensitiveActions = new Set(['approve', 'issue', 'confirm', 'export', 'deploy'])
    const allowedDefaultSensitiveGrants = [
      'commercial_director|altoc:contract_approver|altoc:contract:approve',
      'commercial_director|altoc:contract_approver|altoc:customer:approve',
      'commercial_director|altoc:contract_approver|altoc:quotation:approve',
      'commercial_director|altoc:contract_manager|altoc:dashboard:export',
      'commercial_director|altoc:contract_manager|altoc:receivable:confirm',
      'commercial_director|workflow:approver|workflow:workflow_tasks:approve',
      'department_manager|finance:expense_approver|finance:expenses:approve',
      'department_manager|workflow:approver|workflow:workflow_tasks:approve',
      'finance_accountant|finance:ar_accountant|finance:invoices:issue',
      'finance_director|finance:expense_approver|finance:expenses:approve',
      'finance_director|finance:invoice_approver|finance:invoices:approve',
      'finance_director|finance:manager|finance:dashboard:export',
      'finance_director|finance:manager|finance:reports:export',
      'finance_director|finance:report_viewer|finance:dashboard:export',
      'finance_director|finance:report_viewer|finance:reports:export',
      'finance_director|workflow:approver|workflow:workflow_tasks:approve',
      'general_manager|workflow:approver|workflow:workflow_tasks:approve',
      'hr_director|people:approver|people:assignments:approve',
      'hr_director|people:approver|people:cost_snapshots:approve',
      'hr_director|people:approver|people:performance_cycles:approve',
      'hr_director|people:manager|people:offboarding_tasks:confirm',
      'hr_director|workflow:approver|workflow:workflow_tasks:approve',
      'hr_specialist|workflow:approver|workflow:workflow_tasks:approve',
      'procurement_asset_manager|workflow:approver|workflow:workflow_tasks:approve',
      'project_director|aims:pmo|aims:reports:export',
      'project_director|aims:pmo|aims:timesheet:approve',
      'project_director|aims:project_approver|aims:projects:approve',
      'project_director|aims:project_director|aims:weekly_reports:export',
      'project_director|insights:report_exporter|insights:dashboard:export',
      'project_director|workflow:approver|workflow:workflow_tasks:approve',
      'project_manager|aims:pm|aims:reports:export',
      'project_manager|aims:pm|aims:timesheet:approve',
      'project_manager|aims:pm|aims:work_items:confirm',
      'project_manager|workflow:approver|workflow:workflow_tasks:approve',
      'records_manager|codocs:records_manager|codocs:departments:export',
      'records_manager|codocs:records_manager|codocs:documents:export',
      'records_manager|codocs:records_manager|codocs:projects:export',
      'records_manager|workflow:approver|workflow:workflow_tasks:approve',
      'sales_director|altoc:contract_approver|altoc:contract:approve',
      'sales_director|altoc:contract_approver|altoc:customer:approve',
      'sales_director|altoc:contract_approver|altoc:quotation:approve',
      'sales_director|altoc:contract_manager|altoc:dashboard:export',
      'sales_director|altoc:contract_manager|altoc:receivable:confirm',
      'sales_director|workflow:approver|workflow:workflow_tasks:approve',
      'sales_manager|altoc:contract_manager|altoc:dashboard:export',
      'sales_manager|altoc:contract_manager|altoc:receivable:confirm',
      'sales_manager|workflow:approver|workflow:workflow_tasks:approve'
    ]
    const permissionsByAppRole = new Map<string, string[]>()
    const actualSensitiveGrants = parseSeedAppRoleMaps(seed)
      .filter(({ roleCode }) => roleCode !== 'system_admin')
      .flatMap(({ roleCode, appRoleCode }) => {
        if (!permissionsByAppRole.has(appRoleCode)) {
          const appCode = appRoleCode.split(':')[0]
          permissionsByAppRole.set(appRoleCode, manifestRolePermissions(appCode).get(appRoleCode) || [])
        }
        return permissionsByAppRole.get(appRoleCode)!
          .filter((permission) => {
            const action = permission.split(':').slice(2).join(':')
            return sensitiveActions.has(action)
          })
          .map(permission => `${roleCode}|${appRoleCode}|${permission}`)
      })
      .sort()

    assert.deepEqual(actualSensitiveGrants, allowedDefaultSensitiveGrants)
  })

  test('non-system default enterprise role workflow control and destructive grants stay explicitly allowlisted', () => {
    const seed = workspaceSource('platform/docs/sql/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql')
    const controlActions = new Set(['reject', 'delegate', 'cancel', 'resubmit', 'close', 'archive', 'publish', 'delete'])
    const allowedDefaultControlGrants = [
      'commercial_director|workflow:approver|workflow:workflow_tasks:delegate',
      'commercial_director|workflow:approver|workflow:workflow_tasks:reject',
      'department_manager|workflow:approver|workflow:workflow_tasks:delegate',
      'department_manager|workflow:approver|workflow:workflow_tasks:reject',
      'finance_director|workflow:approver|workflow:workflow_tasks:delegate',
      'finance_director|workflow:approver|workflow:workflow_tasks:reject',
      'general_manager|workflow:approver|workflow:workflow_tasks:delegate',
      'general_manager|workflow:approver|workflow:workflow_tasks:reject',
      'hr_director|people:manager|people:offboarding_tasks:cancel',
      'hr_director|workflow:approver|workflow:workflow_tasks:delegate',
      'hr_director|workflow:approver|workflow:workflow_tasks:reject',
      'hr_specialist|people:specialist|people:offboarding_tasks:cancel',
      'hr_specialist|workflow:approver|workflow:workflow_tasks:delegate',
      'hr_specialist|workflow:approver|workflow:workflow_tasks:reject',
      'procurement_asset_manager|workflow:approver|workflow:workflow_tasks:delegate',
      'procurement_asset_manager|workflow:approver|workflow:workflow_tasks:reject',
      'project_director|aims:pmo|aims:projects:close',
      'project_director|aims:project_director|aims:weekly_reports:publish',
      'project_director|workflow:approver|workflow:workflow_tasks:delegate',
      'project_director|workflow:approver|workflow:workflow_tasks:reject',
      'project_manager|aims:pm|aims:projects:close',
      'project_manager|aims:pm|aims:work_items:delete',
      'project_manager|workflow:approver|workflow:workflow_tasks:delegate',
      'project_manager|workflow:approver|workflow:workflow_tasks:reject',
      'records_manager|codocs:records_manager|codocs:reviews:archive',
      'records_manager|workflow:approver|workflow:workflow_tasks:delegate',
      'records_manager|workflow:approver|workflow:workflow_tasks:reject',
      'sales_director|workflow:approver|workflow:workflow_tasks:delegate',
      'sales_director|workflow:approver|workflow:workflow_tasks:reject',
      'sales_manager|workflow:approver|workflow:workflow_tasks:delegate',
      'sales_manager|workflow:approver|workflow:workflow_tasks:reject'
    ]
    const permissionsByAppRole = new Map<string, string[]>()
    const actualControlGrants = parseSeedAppRoleMaps(seed)
      .filter(({ roleCode }) => roleCode !== 'system_admin')
      .flatMap(({ roleCode, appRoleCode }) => {
        if (!permissionsByAppRole.has(appRoleCode)) {
          const appCode = appRoleCode.split(':')[0]
          permissionsByAppRole.set(appRoleCode, manifestRolePermissions(appCode).get(appRoleCode) || [])
        }
        return permissionsByAppRole.get(appRoleCode)!
          .filter((permission) => {
            const action = permission.split(':').slice(2).join(':')
            return controlActions.has(action)
          })
          .map(permission => `${roleCode}|${appRoleCode}|${permission}`)
      })
      .sort()

    assert.deepEqual(actualControlGrants, allowedDefaultControlGrants)
  })

  test('non-system default enterprise role business workflow grants stay explicitly allowlisted', () => {
    const seed = workspaceSource('platform/docs/sql/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql')
    const workflowActions = new Set([
      'assign',
      'convert',
      'disqualify',
      'transition',
      'submit',
      'execute',
      'activity',
      'delivery-result:sync',
      'finance-summary:sync',
      'mark-billable'
    ])
    const allowedDefaultWorkflowGrants = [
      'hr_specialist|codocs:editor|codocs:reviews:submit',
      'project_manager|aims:pm|aims:timesheet:submit',
      'project_manager|aims:pm|aims:weekly_reports:submit',
      'project_manager|aims:pm|aims:work_items:assign',
      'project_manager|codocs:editor|codocs:reviews:submit',
      'project_member|aims:member|aims:timesheet:submit',
      'project_member|codocs:editor|codocs:reviews:submit',
      'sales_director|altoc:sales|altoc:lead:activity',
      'sales_director|altoc:sales|altoc:lead:assign',
      'sales_director|altoc:sales|altoc:lead:convert',
      'sales_director|altoc:sales|altoc:lead:disqualify',
      'sales_director|altoc:sales|altoc:opportunity:activity',
      'sales_director|altoc:sales|altoc:opportunity:assign',
      'sales_director|altoc:sales|altoc:opportunity:transition',
      'sales_manager|altoc:sales|altoc:lead:activity',
      'sales_manager|altoc:sales|altoc:lead:assign',
      'sales_manager|altoc:sales|altoc:lead:convert',
      'sales_manager|altoc:sales|altoc:lead:disqualify',
      'sales_manager|altoc:sales|altoc:opportunity:activity',
      'sales_manager|altoc:sales|altoc:opportunity:assign',
      'sales_manager|altoc:sales|altoc:opportunity:transition',
      'sales_manager|codocs:editor|codocs:reviews:submit',
      'sales_specialist|altoc:sales|altoc:lead:activity',
      'sales_specialist|altoc:sales|altoc:lead:assign',
      'sales_specialist|altoc:sales|altoc:lead:convert',
      'sales_specialist|altoc:sales|altoc:lead:disqualify',
      'sales_specialist|altoc:sales|altoc:opportunity:activity',
      'sales_specialist|altoc:sales|altoc:opportunity:assign',
      'sales_specialist|altoc:sales|altoc:opportunity:transition',
      'sales_specialist|codocs:editor|codocs:reviews:submit'
    ]
    const permissionsByAppRole = new Map<string, string[]>()
    const actualWorkflowGrants = parseSeedAppRoleMaps(seed)
      .filter(({ roleCode }) => roleCode !== 'system_admin')
      .flatMap(({ roleCode, appRoleCode }) => {
        if (!permissionsByAppRole.has(appRoleCode)) {
          const appCode = appRoleCode.split(':')[0]
          permissionsByAppRole.set(appRoleCode, manifestRolePermissions(appCode).get(appRoleCode) || [])
        }
        return permissionsByAppRole.get(appRoleCode)!
          .filter((permission) => {
            const action = permission.split(':').slice(2).join(':')
            return workflowActions.has(action)
          })
          .map(permission => `${roleCode}|${appRoleCode}|${permission}`)
      })
      .sort()

    assert.deepEqual(actualWorkflowGrants, allowedDefaultWorkflowGrants)
  })

  test('non-system default enterprise role admin-like permissions stay explicitly allowlisted', () => {
    const seed = workspaceSource('platform/docs/sql/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql')
    const adminLikeActions = new Set([
      'admin',
      'deploy',
      'trigger',
      'simulate-role',
      'simulate-user',
      'release',
      'rotate',
      'reveal',
      'retry'
    ])
    const allowedDefaultAdminLikePermissions = new Set([
      'project_director|aims:pmo|aims:portfolios:admin',
      'project_director|aims:project_director|aims:project_templates:admin',
      'project_director|aims:project_director|aims:projects:admin',
      'finance_director|finance:manager|finance:invoices:admin',
      'finance_director|finance:manager|finance:receipts:admin',
      'finance_director|finance:manager|finance:expenses:admin',
      'finance_director|finance:manager|finance:bank_accounts:admin',
      'finance_director|finance:manager|finance:reconciliation:admin',
      'finance_director|finance:manager|finance:project_accounting:admin',
      'finance_director|finance:manager|finance:performance:admin',
      'hr_director|console:directory_operator|console:directory_users:admin',
      'hr_director|console:directory_operator|console:directory_departments:admin',
      'hr_director|console:directory_operator|console:directory_projects:admin',
      'hr_director|people:manager|people:employees:admin',
      'hr_director|people:manager|people:assignments:admin',
      'hr_director|people:manager|people:offboarding_tasks:admin'
    ])
    const permissionsByAppRole = new Map<string, string[]>()
    const unexpectedAdminLikePermissions = parseSeedAppRoleMaps(seed)
      .filter(({ roleCode }) => roleCode !== 'system_admin')
      .flatMap(({ roleCode, appRoleCode }) => {
        if (!permissionsByAppRole.has(appRoleCode)) {
          const appCode = appRoleCode.split(':')[0]
          permissionsByAppRole.set(appRoleCode, manifestRolePermissions(appCode).get(appRoleCode) || [])
        }
        return permissionsByAppRole.get(appRoleCode)!
          .filter((permission) => {
            const action = permission.split(':').slice(2).join(':')
            return adminLikeActions.has(action)
          })
          .map(permission => ({ roleCode, appRoleCode, permission }))
      })
      .filter(({ roleCode, appRoleCode, permission }) =>
        !allowedDefaultAdminLikePermissions.has(`${roleCode}|${appRoleCode}|${permission}`)
      )

    assert.deepEqual(unexpectedAdminLikePermissions, [])
  })

  test('dev DB ready verifier checks role simulation capability materialization and bundle grants', () => {
    const verifier = platformSource('scripts/verify-platform-dev-db.mjs')

    assert.match(verifier, /checkPlatformAuthorizationSimulationCapability/)
    assert.match(verifier, /platform_app_manifest_resource_actions/)
    assert.match(verifier, /platform_app_role_permissions/)
    assert.match(verifier, /platform_system_app_role_maps/)
    assert.match(verifier, /tenant_role_app_role_maps/)
    assert.match(verifier, /rolePermissionGrants/)
    assert.match(verifier, /platform:authorization_admin/)
    assert.match(verifier, /platform:authorization_simulator/)
    assert.match(verifier, /simulate-role/)
    assert.match(verifier, /simulate-user/)
    assert.match(verifier, /system_admin/)
  })

  test('platform policy role acceptance script validates v2 simulator grants', () => {
    const acceptScript = workspaceSource('scripts/accept-platform-policy-roles.mjs')

    assert.match(acceptScript, /POLICY_BUNDLE_V2_SCHEMA_VERSION = 'policy-bundle\.v2'/)
    assert.match(acceptScript, /payload\.schemaVersion/)
    assert.match(acceptScript, /payload\.compatSchemaVersions/)
    assert.match(acceptScript, /payload\.roleAssignments/)
    assert.match(acceptScript, /payload\.rolePermissionGrants/)
    assert.match(acceptScript, /platform:authorization_admin/)
    assert.match(acceptScript, /platform:authorization_simulator/)
    assert.match(acceptScript, /platform:authorization:simulate-role/)
    assert.match(acceptScript, /platform:authorization:simulate-user/)
    assert.match(acceptScript, /role simulation permissions still come from/)
    assert.doesNotMatch(acceptScript, /payload\.subjectRoles\b/)
    assert.doesNotMatch(acceptScript, /payload\.rolePermissions\b/)
  })

  test('dev DB init runbook guides operators through v2 role simulation acceptance', () => {
    const initScript = platformSource('deploy/mysql/init-hzy-platform-dev.sh')

    assert.match(initScript, /import current app manifests/)
    assert.match(initScript, /HZY-Platform-SQL-Seed-v2\.16-enterprise-roles\.sql/)
    assert.match(initScript, /accept:platform-policy-roles/)
    assert.match(initScript, /policy-bundle\.v2 roleAssignments\/rolePermissionGrants/)
    assert.match(initScript, /platform:authorization_simulator/)
    assert.match(initScript, /db:verify-dev/)
    assert.match(initScript, /--mode ready/)
  })
})
