import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

type ManifestRole = {
  code: string
  suggestedPermissions?: string[]
}

type ManifestResource = {
  code: string
  actions?: string[]
}

function readText(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

const manifest = JSON.parse(readText('../app.manifest.json')) as {
  resources: ManifestResource[]
  recommendedRoles: ManifestRole[]
}

function role(code: string) {
  const found = manifest.recommendedRoles.find(item => item.code === code)
  assert.ok(found, `missing recommended role ${code}`)
  return found
}

function permissions(code: string) {
  return role(code).suggestedPermissions || []
}

function assertNoPermissionSuffix(roleCode: string, suffixes: string[]) {
  for (const permission of permissions(roleCode)) {
    assert.equal(
      suffixes.some(suffix => permission.endsWith(suffix)),
      false,
      `${roleCode} should not include ${permission}`
    )
  }
}

function assertBefore(content: string, before: string, after: string) {
  const beforeIndex = content.indexOf(before)
  const afterIndex = content.indexOf(after)
  assert.ok(beforeIndex >= 0, `missing ${before}`)
  assert.ok(afterIndex >= 0, `missing ${after}`)
  assert.ok(beforeIndex < afterIndex, `${before} should appear before ${after}`)
}

const awaitedUserPermission = 'await measureRequestStage(event, \'people_permission\', () => requireRuntimeUserPermission(event))'

describe('People recommended role split', () => {
  test('offboarding task confirmation and cancellation stay explicit and separate from employee or assignment edits', () => {
    const resource = manifest.resources.find(item => item.code === 'offboarding_tasks')
    assert.deepEqual(resource?.actions, ['view', 'edit', 'confirm', 'cancel', 'admin'])

    assert.ok(permissions('people:employee').includes('people:offboarding_tasks:confirm'))
    assert.ok(permissions('people:department_manager').includes('people:offboarding_tasks:confirm'))
    assert.ok(permissions('people:manager').includes('people:offboarding_tasks:confirm'))
    assert.ok(permissions('people:admin').includes('people:offboarding_tasks:confirm'))
    assert.ok(permissions('people:specialist').includes('people:offboarding_tasks:cancel'))
    assert.ok(permissions('people:admin').includes('people:offboarding_tasks:cancel'))

    assertNoPermissionSuffix('people:employee', [':edit', ':cancel', ':admin'])
    assertNoPermissionSuffix('people:department_manager', [':edit', ':cancel', ':admin'])
    assertNoPermissionSuffix('people:specialist', [':confirm'])
    assertNoPermissionSuffix('people:approver', [':confirm', ':cancel'])
  })

  test('ordinary People authorization ignores legacy active-role selectors', () => {
    const permissionsRoute = readText('../server/api/auth/permissions.get.ts')
    const permissionHelper = readText('../server/utils/peoplePermissions.ts')
    const clientAuthorization = readText('../app/composables/usePeopleAuthorization.ts')
    const adminSources = [
      '../server/api/admin/cost-parameters/current.get.ts',
      '../server/api/admin/cost-snapshots/generate.post.ts',
      '../server/api/admin/directory-sync/import.post.ts',
      '../server/api/admin/directory-users/[uid]/disable.post.ts',
      '../server/api/admin/performance-amounts.get.ts',
      '../server/api/admin/performance-cycles.post.ts',
      '../server/api/admin/performance-cycles/[code]/close.post.ts',
      '../server/api/admin/performance-cycles/[code]/collect.post.ts',
      '../server/api/admin/performance-cycles/[code]/confirm.post.ts',
      '../server/api/admin/rank-settings/current.get.ts'
    ].map(readText).join('\n')
    const pageSources = [
      '../app/pages/cost-snapshots.vue',
      '../app/pages/employees/[uid].vue',
      '../app/pages/employees/index.vue',
      '../app/pages/performance-cycles/[code].vue',
      '../app/pages/performance-cycles/index.vue'
    ].map(readText).join('\n')
    const tenantRuntimeMiddleware = readText('../server/middleware/tenant-runtime.ts')

    assert.doesNotMatch(permissionsRoute, /getQuery/)
    assert.doesNotMatch(permissionsRoute, /activeRoleCode[\s\S]{0,120}url\.searchParams\.set/)
    assert.match(permissionsRoute, /requireFoundationSessionUid\(event/)
    assert.match(permissionsRoute, /loadAuthorizationSnapshotFromConsoleRuntime\(uid, appCode, event\)/)
    assert.doesNotMatch(permissionsRoute, /\/api\/auth\/permissions/)
    assert.doesNotMatch(permissionsRoute, /\$fetch/)
    assert.match(permissionHelper, /requireFoundationSessionUid\(event/)
    assert.match(permissionHelper, /loadAuthorizationSnapshotFromConsoleRuntime\(uid, appCode, event\)/)
    assert.doesNotMatch(permissionHelper, /\/api\/auth\/permissions/)
    assert.doesNotMatch(permissionHelper, /\$fetch/)
    assert.doesNotMatch(permissionHelper, /activeRoleCode\s*\}/)
    assert.doesNotMatch(clientAuthorization, /loadPermissions\(\{\s*activeRoleCode/)
    assert.doesNotMatch(clientAuthorization, /availableRoles/)
    assert.doesNotMatch(adminSources, /assertPeoplePermission\(event,\s*activeRoleCode/)
    assert.doesNotMatch(adminSources, /text\([^)]*activeRoleCode/)
    assert.doesNotMatch(pageSources, /activeRoleCode:/)
    assert.match(tenantRuntimeMiddleware, /context\.suffix === '\/dashboard\/overview'[\s\S]{0,80}return 'employees'/)
    assert.match(tenantRuntimeMiddleware, /context\.suffix === '\/documents'[\s\S]{0,80}return 'documents'/)
    assert.match(tenantRuntimeMiddleware, /const needsStandardCosts = isDashboardOverviewContext\(context\) \|\| isEmployeeRecordContext\(context\)/)
  })

  test('service-only People runtime proxy requires Console service token before forwarding', () => {
    const tenantRuntimeMiddleware = readText('../server/middleware/tenant-runtime.ts')

    assertBefore(
      tenantRuntimeMiddleware,
      'await requireForwardedServiceCapability(event)',
      'maybeProxyCurrentApiToTenantRuntime(event'
    )
    assertBefore(
      tenantRuntimeMiddleware,
      'await requireForwardedServiceCapability(event)',
      awaitedUserPermission
    )
    assert.match(tenantRuntimeMiddleware, /suffix === '\/service\/standard-costs:resolve'[\s\S]{0,120}scope: 'people:read'[\s\S]{0,80}allowedApps: \['finance'\]/)
    assert.match(tenantRuntimeMiddleware, /\/\^\\\/service\\\/employees\\\/\[\^\/\]\+\\\/cost-snapshot\$\/\.test\(suffix\)[\s\S]{0,120}scope: 'people:read'[\s\S]{0,80}allowedApps: \['finance'\]/)
    assert.match(tenantRuntimeMiddleware, /\/\^\\\/service\\\/projects\\\/\[\^\/\]\+\\\/people-costs\$\/\.test\(suffix\)[\s\S]{0,120}scope: 'people:read'[\s\S]{0,80}allowedApps: \['finance'\]/)
    assert.match(tenantRuntimeMiddleware, /suffix === '\/service\/directory-users:sync'[\s\S]{0,120}scope: 'people:write'[\s\S]{0,80}allowedApps: \['console'\]/)
    assert.match(tenantRuntimeMiddleware, /suffix === '\/service\/contributions:sync'[\s\S]{0,120}scope: 'people:write'[\s\S]{0,80}allowedApps: \['aims'\]/)
    assert.match(tenantRuntimeMiddleware, /\/\^\\\/service\\\/performance-cycles\\\/\[\^\/\]\+:\(confirm\|close\)\$\/\.test\(suffix\)[\s\S]{0,120}scope: 'people:write'[\s\S]{0,80}allowedApps: \['people'\]/)
    assert.match(tenantRuntimeMiddleware, /suffix\.startsWith\('\/service\/'\)[\s\S]{0,160}Unsupported People service endpoint capability/)
  })

  test('ordinary People runtime proxy requires user permission before forwarding', () => {
    const tenantRuntimeMiddleware = readText('../server/middleware/tenant-runtime.ts')

    assert.match(tenantRuntimeMiddleware, /resolveConsoleAuthWithSessionBridge/)
    assertBefore(
      tenantRuntimeMiddleware,
      'await ensureConsoleAuthContext(event)',
      'await requireForwardedServiceCapability(event)'
    )
    assertBefore(
      tenantRuntimeMiddleware,
      'await ensureConsoleAuthContext(event)',
      awaitedUserPermission
    )
    assertBefore(
      tenantRuntimeMiddleware,
      'await ensureConsoleAuthContext(event)',
      'maybeProxyCurrentApiToTenantRuntime(event'
    )
    assert.match(tenantRuntimeMiddleware, /event\.context\.consoleAuth = await resolveConsoleAuthWithSessionBridge\(event\)/)
    assertBefore(
      tenantRuntimeMiddleware,
      awaitedUserPermission,
      'const runtimeResponse = await maybeProxyCurrentApiToTenantRuntime(event'
    )
    assertBefore(
      tenantRuntimeMiddleware,
      awaitedUserPermission,
      'const operationKey = directoryLifecycleOperationKey(runtimeResponse)'
    )
    assertBefore(
      tenantRuntimeMiddleware,
      awaitedUserPermission,
      'await dispatchDirectoryLifecycleOperation(event, operationKey)'
    )
    assertBefore(
      tenantRuntimeMiddleware,
      awaitedUserPermission,
      'maybeProxyCurrentApiToTenantRuntime(event'
    )
    assert.match(tenantRuntimeMiddleware, /suffix\.startsWith\('\/service\/'\)/)
    assert.match(tenantRuntimeMiddleware, /suffix === '\/dashboard\/overview'[\s\S]{0,80}resource: 'dashboard'[\s\S]{0,80}action: 'view'/)
    assert.match(tenantRuntimeMiddleware, /\/\^\\\/employees\\\/\[\^\/\]\+\\\/profile\$\/\.test\(suffix\)[\s\S]{0,140}resource: 'employees'[\s\S]{0,80}writeAction\(method\)/)
    assert.match(tenantRuntimeMiddleware, /suffix === '\/documents'[\s\S]{0,120}resource: 'documents'[\s\S]{0,80}writeAction\(method\)/)
    assert.match(tenantRuntimeMiddleware, /suffix === '\/standard-costs'[\s\S]{0,140}resource: 'standard_costs'[\s\S]{0,80}writeAction\(method, 'admin'\)/)
    assert.match(tenantRuntimeMiddleware, /suffix === '\/positions'[\s\S]{0,120}resource: 'positions'[\s\S]{0,80}writeAction\(method, 'admin'\)/)
    assert.match(tenantRuntimeMiddleware, /suffix === '\/ranks'[\s\S]{0,120}resource: 'ranks'[\s\S]{0,80}writeAction\(method, 'admin'\)/)
  })

  test('People scoped runtime query preserves trusted app admin and actor context', () => {
    const tenantRuntimeMiddleware = readText('../server/middleware/tenant-runtime.ts')
    const scopedAuthorization = readText('../server/utils/peopleScopedAuthorization.ts')

    assert.match(scopedAuthorization, /permission\.resourceCode === 'admin' && permission\.action === 'admin'/)
    assert.match(scopedAuthorization, /function employeeAccessQuery\(result: EmployeeScopeResult, uid = ''\)/)
    assert.match(scopedAuthorization, /query\.current_user = normalizedUid/)
    assert.match(scopedAuthorization, /query\.operator_uid = normalizedUid/)
    assert.match(scopedAuthorization, /return employeeAccessQuery\(scope, normalizedUid\)/)
    assert.match(tenantRuntimeMiddleware, /'current_user'/)
    assert.match(tenantRuntimeMiddleware, /'currentUser'/)
    assert.match(tenantRuntimeMiddleware, /'operator_uid'/)
    assert.match(tenantRuntimeMiddleware, /'operatorUid'/)
  })

  test('unknown ordinary People runtime paths fail closed before tenant-runtime proxy', () => {
    const tenantRuntimeMiddleware = readText('../server/middleware/tenant-runtime.ts')
    const userPermissionBlock = tenantRuntimeMiddleware.slice(
      tenantRuntimeMiddleware.indexOf('async function requireRuntimeUserPermission')
    )

    assert.match(userPermissionBlock, /if \(!suffix \|\| suffix\.startsWith\('\/service\/'\)\) return/)
    assert.match(userPermissionBlock, /if \(!requirement\) \{[\s\S]{0,180}Unsupported People runtime endpoint permission/)
    assertBefore(
      tenantRuntimeMiddleware,
      awaitedUserPermission,
      'maybeProxyCurrentApiToTenantRuntime(event'
    )
    assertBefore(
      userPermissionBlock,
      'const requirement = runtimePermissionRequirement(suffix, method)',
      'if (!requirement) {'
    )
    assertBefore(
      userPermissionBlock,
      'suffix.startsWith(\'/service/\')',
      'Unsupported People runtime endpoint permission.'
    )
  })

  test('employee read paths carry dedicated cost field authorization', () => {
    const tenantRuntimeMiddleware = readText('../server/middleware/tenant-runtime.ts')
    const dataRuntimeAccess = readText('../../data-runtime/internal/apps/people/employee_access.go')
    const dataRuntimeAdapter = readText('../../data-runtime/internal/apps/people/adapter.go')
    const dataRuntimeProfile = readText('../../data-runtime/internal/apps/people/runtime.go')
    const employeeDetailPage = readText('../app/pages/employees/[uid].vue')
    const dashboardOverview = dataRuntimeProfile.slice(
      dataRuntimeProfile.indexOf('func (a *Adapter) dashboardOverview'),
      dataRuntimeProfile.indexOf('func scopedEmployeeWhere')
    )

    assert.match(tenantRuntimeMiddleware, /const needsStandardCosts = [^\n]*isEmployeeRecordContext\(context\)/)
    assert.match(tenantRuntimeMiddleware, /context\.method === 'GET' \|\| isEmployeeSearchContext\(context\) \? 'view' : 'admin'/)
    assert.match(tenantRuntimeMiddleware, /peopleEmployeeSearchRoutePolicy\(suffix, method\)[\s\S]{0,80}return searchPolicy\.permission/)
    assert.match(tenantRuntimeMiddleware, /isEmployeeProfileContext\(context\)[\s\S]{0,1200}'cost_snapshots'/)
    assert.match(tenantRuntimeMiddleware, /current_user_cost_snapshot_access/)
    assert.match(tenantRuntimeMiddleware, /isEmployeeProfileContext\(context\)[\s\S]{0,1200}'assignments'/)
    assert.match(tenantRuntimeMiddleware, /current_user_assignment_access/)
    assert.match(tenantRuntimeMiddleware, /isEmployeeProfileContext\(context\)[\s\S]{0,1200}'performance_cycles'/)
    assert.match(tenantRuntimeMiddleware, /current_user_performance_cycle_access/)
    assert.match(tenantRuntimeMiddleware, /isEmployeeProfileContext\(context\)[\s\S]{0,1600}'documents'/)
    assert.match(tenantRuntimeMiddleware, /current_user_document_access/)
    assert.match(dataRuntimeAdapter, /isEmployeeRuntimePath\(path\) \|\| isAssignmentRuntimePath\(path\)[\s\S]{0,120}redactEmployeeSensitiveCostFieldsInResponse\(query, result\)/)
    assert.match(dataRuntimeAccess, /delete\(row, "monthly_standard_cost"\)/)
    assert.match(dataRuntimeAccess, /delete\(row, "cost_center_code"\)/)
    assert.match(dataRuntimeAccess, /delete\(row, "rank_code"\)/)
    assert.match(dataRuntimeAccess, /delete\(row, "rank_name"\)/)
    assert.match(dataRuntimeProfile, /hasStandardCostReadAccess\(query\)[\s\S]{0,220}currentMonthActualCost\(ctx, query\)/)
    assertBefore(dashboardOverview, 'redactEmployeeSensitiveCostFieldsInResponse(query, assignments)', '"recent_assignments": assignments')
    assert.match(dataRuntimeProfile, /redactEmployeeSensitiveCostFieldsInResponse\(query, assignments\)/)
    assert.doesNotMatch(employeeDetailPage, /body\.rank_code\s*=/)
    assert.doesNotMatch(employeeDetailPage, /body\.rank_name\s*=/)
    assert.match(dataRuntimeAdapter, /people_employee_rank_requires_assignment_change/)
    assert.match(employeeDetailPage, /if \(canEditSensitiveCostFields\.value\) \{[\s\S]{0,160}body\.cost_center_code/)
    assert.match(employeeDetailPage, /v-model="editForm\.costCenterCode"[\s\S]{0,120}:disabled="!canEditSensitiveCostFields"/)
    assert.match(dataRuntimeAccess, /canReadEmployeeProfileAssignments/)
    assert.match(dataRuntimeAccess, /canReadEmployeeProfileCostSnapshots/)
    assert.match(dataRuntimeAccess, /canReadEmployeeProfilePerformanceCycles/)
    assert.match(dataRuntimeAccess, /canReadEmployeeProfileDocuments/)
    assert.match(dataRuntimeProfile, /!canReadEmployeeProfileAssignments\(query, employee\)[\s\S]{0,80}assignments = \[\]map\[string\]any\{\}/)
    assert.match(dataRuntimeProfile, /!canReadEmployeeProfileCostSnapshots\(query, employee\)[\s\S]{0,80}costSnapshots = \[\]map\[string\]any\{\}/)
    assert.match(dataRuntimeProfile, /!canReadEmployeeProfilePerformanceCycles\(query, employee\)[\s\S]{0,120}contributions = \[\]map\[string\]any\{\}/)
    assert.match(dataRuntimeProfile, /!canReadEmployeeProfilePerformanceCycles\(query, employee\)[\s\S]{0,160}cycles = \[\]map\[string\]any\{\}/)
    assert.match(dataRuntimeProfile, /!canReadEmployeeProfileDocuments\(query, employee\)[\s\S]{0,80}documents = \[\]map\[string\]any\{\}/)
  })

  test('performance cycle terminal transitions cannot use ordinary edit path', () => {
    const createCycleRoute = readText('../server/api/admin/performance-cycles.post.ts')
    const confirmCycleRoute = readText('../server/api/admin/performance-cycles/[code]/confirm.post.ts')
    const closeCycleRoute = readText('../server/api/admin/performance-cycles/[code]/close.post.ts')
    const dataRuntimeAdapter = readText('../../data-runtime/internal/apps/people/adapter.go')
    const dataRuntimeTest = readText('../../data-runtime/internal/apps/people/performance_access_test.go')

    assert.match(createCycleRoute, /assertPeoplePermission\(event,\s*'performance_cycles',\s*'edit'\)/)
    assert.doesNotMatch(createCycleRoute, /status:\s*'draft'/)
    assert.match(confirmCycleRoute, /assertPeoplePermission\(event,\s*'performance_cycles',\s*'approve'\)/)
    assert.doesNotMatch(confirmCycleRoute, /assertPeoplePermission\(event,\s*'performance_cycles',\s*'edit'\)/)
    assert.match(closeCycleRoute, /assertPeoplePermission\(event,\s*'performance_cycles',\s*'approve'\)/)
    assert.doesNotMatch(closeCycleRoute, /assertPeoplePermission\(event,\s*'performance_cycles',\s*'edit'\)/)
    assert.match(dataRuntimeAdapter, /rejectGenericPerformanceCycleTerminalMutation\(method, path, body\)/)
    assert.match(dataRuntimeAdapter, /people_performance_cycle_status_requires_approval/)
    assert.match(dataRuntimeAdapter, /Performance cycle status transitions must use confirm\/close service actions/)
    assert.match(dataRuntimeTest, /TestRejectGenericPerformanceCycleTerminalMutation/)
  })

  test('assignment approval status cannot use ordinary edit path', () => {
    const employeeDetailPage = readText('../app/pages/employees/[uid].vue')
    const dataRuntimeAdapter = readText('../../data-runtime/internal/apps/people/adapter.go')
    const dataRuntimeTest = readText('../../data-runtime/internal/apps/people/employee_access_test.go')
    const workflowCallbackRoute = readText('../server/api/v1/service/workflow/callback.post.ts')

    assert.doesNotMatch(employeeDetailPage, /approval_status:\s*'approved'/)
    assert.match(dataRuntimeAdapter, /rejectGenericAssignmentApprovalMutation\(method, path, body\)/)
    assert.match(dataRuntimeAdapter, /people_assignment_approval_requires_workflow/)
    assert.match(dataRuntimeAdapter, /Assignment approval status must be updated through Workflow callback service/)
    assert.match(dataRuntimeTest, /TestRejectGenericAssignmentApprovalMutation/)
    assert.match(workflowCallbackRoute, /requireServiceScope\(event, \{ scope: 'workflow:callback', allowedApps: \['workflow'\] \}\)/)
  })

  test('cost snapshot confirmation cannot use ordinary edit path', () => {
    const dataRuntimeAdapter = readText('../../data-runtime/internal/apps/people/adapter.go')
    const dataRuntimeTest = readText('../../data-runtime/internal/apps/people/employee_access_test.go')

    assert.match(dataRuntimeAdapter, /rejectGenericCostSnapshotConfirmationMutation\(method, path, body\)/)
    assert.match(dataRuntimeAdapter, /people_cost_snapshot_confirmation_requires_approval/)
    assert.match(dataRuntimeAdapter, /Cost snapshot confirmation must use an approval-protected service action/)
    assert.match(dataRuntimeTest, /TestRejectGenericCostSnapshotConfirmationMutation/)
  })

  test('manifest declares narrow People duty roles beside system admin role', () => {
    const documentsResource = manifest.resources.find(item => item.code === 'documents')
    assert.deepEqual(documentsResource?.actions, ['view', 'edit', 'admin'])
    assert.equal(permissions('people:specialist').includes('people:documents:edit'), true)
    assert.equal(permissions('people:specialist').includes('people:ranks:view'), true)
    assert.equal(permissions('people:directory_admin').includes('people:documents:admin'), true)
    assert.equal(permissions('people:admin').includes('people:documents:admin'), true)
    assert.equal(permissions('people:compensation_admin').some(permission => permission.includes(':documents:')), false)

    assert.deepEqual(
      [
        'people:employee',
        'people:department_manager',
        'people:specialist',
        'people:manager',
        'people:approver',
        'people:performance_manager',
        'people:compensation_admin',
        'people:directory_admin',
        'people:admin'
      ].map(code => role(code).code),
      [
        'people:employee',
        'people:department_manager',
        'people:specialist',
        'people:manager',
        'people:approver',
        'people:performance_manager',
        'people:compensation_admin',
        'people:directory_admin',
        'people:admin'
      ]
    )
  })

  test('daily HR roles do not include approval, compensation, performance or settings administration', () => {
    assertNoPermissionSuffix('people:specialist', [':admin', ':approve'])
    assert.equal(permissions('people:specialist').some(permission => permission.includes(':standard_costs:')), false)
    assert.equal(permissions('people:specialist').some(permission => permission.includes(':cost_snapshots:')), false)

    assertNoPermissionSuffix('people:manager', [':approve'])
    assert.equal(permissions('people:manager').includes('people:standard_costs:admin'), false)
    assert.equal(permissions('people:manager').includes('people:cost_snapshots:admin'), false)
    assert.equal(permissions('people:manager').includes('people:performance_cycles:admin'), false)
    assert.equal(permissions('people:manager').includes('people:positions:admin'), false)
    assert.equal(permissions('people:manager').includes('people:ranks:admin'), false)
    assert.equal(permissions('people:manager').includes('people:admin:admin'), false)
  })

  test('approval, self-service, department, performance and compensation roles stay separated', () => {
    assert.equal(permissions('people:approver').includes('people:assignments:approve'), true)
    assert.equal(permissions('people:approver').includes('people:cost_snapshots:approve'), true)
    assert.equal(permissions('people:approver').includes('people:performance_cycles:approve'), true)
    assertNoPermissionSuffix('people:approver', [':admin', ':edit'])

    assertNoPermissionSuffix('people:employee', [':admin', ':approve', ':edit'])
    assertNoPermissionSuffix('people:department_manager', [':admin', ':approve', ':edit'])
    assertNoPermissionSuffix('people:performance_manager', [':approve'])
    assert.equal(permissions('people:performance_manager').includes('people:performance_cycles:admin'), true)

    assert.equal(permissions('people:compensation_admin').includes('people:standard_costs:admin'), true)
    assert.equal(permissions('people:compensation_admin').includes('people:cost_snapshots:admin'), true)
    assert.equal(permissions('people:compensation_admin').includes('people:ranks:view'), true)
    assertNoPermissionSuffix('people:compensation_admin', [':approve'])

    assert.equal(permissions('people:directory_admin').includes('people:positions:admin'), true)
    assert.equal(permissions('people:directory_admin').includes('people:ranks:admin'), true)
    assert.equal(permissions('people:directory_admin').includes('people:admin:admin'), true)
  })

  test('platform seed maps HR roles away from people:admin', () => {
    const seed = readText('../../platform/docs/sql/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql')

    assert.match(seed, /\('system_admin', 'people:admin', 90\)/)
    assert.match(seed, /\('hr_director', 'people:manager', 40\)/)
    assert.match(seed, /\('hr_director', 'people:approver', 50\)/)
    assert.match(seed, /\('hr_specialist', 'people:specialist', 30\)/)
    assert.doesNotMatch(seed, /\('hr_specialist', 'console:/)
    assert.doesNotMatch(seed, /\('hr_director', 'people:admin',/)
    assert.doesNotMatch(seed, /\('hr_specialist', 'people:admin',/)
    assert.doesNotMatch(seed, /\('department_manager', 'people:department_manager',/)
  })
})
