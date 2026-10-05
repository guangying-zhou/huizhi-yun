import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { matchRouteRule } from '../app/config/permissions.ts'
import { resolveFinanceApiPermission } from '../server/utils/financePermissionRoutes.ts'

function manifest() {
  return JSON.parse(readFileSync(new URL('../app.manifest.json', import.meta.url), 'utf8')) as {
    recommendedRoles: Array<{ code: string, suggestedPermissions: string[] }>
  }
}

function rolePermissions(code: string) {
  const role = manifest().recommendedRoles.find(item => item.code === code)
  assert.ok(role, `${code} role must exist`)
  return role.suggestedPermissions
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)
  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

function listFiles(root: URL): URL[] {
  const files: URL[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, root)
    if (entry.isDirectory()) {
      files.push(...listFiles(child))
    } else {
      files.push(child)
    }
  }
  return files
}

describe('resolveFinanceApiPermission sensitive status mapping', () => {
  test('front-end wildcard route rules also guard section root paths', () => {
    assert.deepEqual(
      matchRouteRule('/invoices'),
      { pattern: '/invoices/**', resource: 'invoices', action: 'view' }
    )
    assert.deepEqual(
      matchRouteRule('/invoices/'),
      { pattern: '/invoices/**', resource: 'invoices', action: 'view' }
    )
    assert.deepEqual(
      matchRouteRule('/reports'),
      { pattern: '/reports/**', resource: 'reports', action: 'view' }
    )
    assert.deepEqual(
      matchRouteRule('/settings'),
      { pattern: '/settings/**', resource: 'settings', action: 'admin' }
    )
    assert.deepEqual(
      matchRouteRule('/invoices/INV-001/edit'),
      { pattern: '/invoices/**', resource: 'invoices', action: 'view' }
    )
  })

  test('普通权限和应用列表请求不再发送旧 activeRoleCode query', () => {
    const authorizationComposable = readFileSync(new URL('../app/composables/useAuthorization.ts', import.meta.url), 'utf8')
    const applicationsComposable = readFileSync(new URL('../app/composables/useUserApplications.ts', import.meta.url), 'utf8')
    const permissionsApi = readFileSync(new URL('../server/api/auth/permissions.get.ts', import.meta.url), 'utf8')

    assert.doesNotMatch(authorizationComposable, /api\/auth\/permissions'[\s\S]{0,240}query:/)
    assert.doesNotMatch(authorizationComposable, /activeRoleCode:\s*requestedActiveRoleCode/)
    assert.doesNotMatch(authorizationComposable, /useActiveRole\(/)
    assert.doesNotMatch(authorizationComposable, /activeRoleCodeOverride/)
    assert.doesNotMatch(authorizationComposable, /options\.activeRoleCode/)
    assert.doesNotMatch(authorizationComposable, /requestedActiveRoleCode/)
    assert.doesNotMatch(authorizationComposable, /preferredActiveRoleCode/)
    assert.doesNotMatch(authorizationComposable, /setActiveRoleCode/)
    assert.doesNotMatch(applicationsComposable, /activeRoleCode/)
    assert.doesNotMatch(applicationsComposable, /query:/)
    assert.doesNotMatch(permissionsApi, /getQuery/)
    assert.doesNotMatch(permissionsApi, /activeRoleCode:\s*query/)
  })

  test('direct invoice approval statuses require invoices/approve', () => {
    assert.deepEqual(
      resolveFinanceApiPermission('invoice-requests', 'POST', { status: 'approved' }),
      { resource: 'invoices', action: 'approve' }
    )
    assert.deepEqual(
      resolveFinanceApiPermission('invoice-requests', 'POST', { status: 'issued' }),
      { resource: 'invoices', action: 'approve' }
    )
  })

  test('issuing an approved invoice requires the independent invoices/issue action', () => {
    assert.deepEqual(
      resolveFinanceApiPermission('invoice-requests/REQ-001/issue', 'POST'),
      { resource: 'invoices', action: 'issue' }
    )
    assert.deepEqual(
      resolveFinanceApiPermission('invoice-requests/REQ-001/assign-issuance', 'POST'),
      { resource: 'invoices', action: 'issue' }
    )

    const page = readFileSync(new URL('../app/pages/[...slug].vue', import.meta.url), 'utf8')
    const dialogs = readFileSync(new URL('../app/components/invoices/InvoiceRequestDialogs.vue', import.meta.url), 'utf8')
    assert.match(page, /hasPermission\('invoices', 'issue'\)/)
    assert.match(page, /return sourceStatus\(row\) === 'approved'/)
    assert.match(page, /const keyword = ref\(routeKeyword\(\)\)/)
    assert.match(page, /watch\(\(\) => route\.query\.keyword/)
    assert.doesNotMatch(dialogs, /issuedBy:\s*currentUserId/)
    assert.match(dialogs, /async function submitAssignment\(\)/)
    assert.match(dialogs, /async function submitIssue\(\)/)
    assert.match(dialogs, /\/assign-issuance`/)
    assert.match(dialogs, /\/issue`/)
  })

  test('expense request approval statuses require expenses/approve', () => {
    for (const path of ['expense-claims', 'project-expense-requests', 'payment-requests']) {
      assert.deepEqual(
        resolveFinanceApiPermission(path, 'POST', { status: 'approved' }),
        { resource: 'expenses', action: 'approve' }
      )
    }
  })

  test('expense payment or confirmation statuses require expenses/confirm', () => {
    for (const path of ['expenses', 'expense-claims', 'project-expense-requests', 'payment-requests']) {
      assert.deepEqual(
        resolveFinanceApiPermission(path, 'POST', { status: 'paid' }),
        { resource: 'expenses', action: 'confirm' }
      )
    }

    assert.deepEqual(
      resolveFinanceApiPermission('expenses', 'POST'),
      { resource: 'expenses', action: 'confirm' }
    )
  })

  test('draft and pending status mutations stay on edit permission', () => {
    assert.deepEqual(
      resolveFinanceApiPermission('expense-claims', 'POST', { status: 'draft' }),
      { resource: 'expenses', action: 'edit' }
    )
    assert.deepEqual(
      resolveFinanceApiPermission('payment-requests', 'POST', { status: 'pending_approval' }),
      { resource: 'expenses', action: 'edit' }
    )
  })

  test('instance conflict explanation is a read-only Finance authorization diagnostic', () => {
    assert.deepEqual(
      resolveFinanceApiPermission('authorization/instance-conflict-explain', 'POST'),
      { resource: 'expenses', action: 'view' }
    )
  })

  test('reports page export action is gated by reports/export permission', () => {
    const page = readFileSync(new URL('../app/pages/[...slug].vue', import.meta.url), 'utf8')
    const reportExport = readFileSync(new URL('../app/composables/useFinanceReportExport.ts', import.meta.url), 'utf8')

    assert.match(page, /canExportReports = computed/)
    assert.match(page, /hasPermission\('reports', 'export'\)/)
    assert.match(page, /downloadReportsExport/)
    assert.match(reportExport, /financeApiPath\('\/reports\/export'\)/)
    assert.match(reportExport, /responseType: 'blob'/)
    assert.match(page, />\s*导出\s*<\/UButton>/)
  })

  test('invoice file preview verifies tenant-runtime invoice facts before signing file URLs', () => {
    const viewRoute = readFileSync(new URL('../server/api/v1/finance/invoices/files/view.get.ts', import.meta.url), 'utf8')
    const listPreview = readFileSync(new URL('../app/components/invoices/InvoiceFilePreview.vue', import.meta.url), 'utf8')
    const editPage = readFileSync(new URL('../app/pages/invoices/[code]/edit.vue', import.meta.url), 'utf8')

    assert.match(viewRoute, /maybeCallFinanceDataRuntime<RuntimeEnvelope<InvoiceRow>>/)
    assert.match(viewRoute, /buildFinanceRuntimeAuthQuery\(event, path, 'GET', \{\}\)/)
    assert.match(viewRoute, /query\.code \|\| query\.invoiceCode \|\| query\.invoice_code/)
    assert.match(viewRoute, /sourceMatchesInvoiceFile/)
    assert.match(viewRoute, /Finance tenant-runtime is required for invoice file previews\./)
    assertBefore(
      viewRoute,
      'await assertInvoiceFileAccess(event, invoiceCode, source)',
      'return sendRedirect(event, legacyUrl, 302)'
    )
    assertBefore(
      viewRoute,
      'await assertInvoiceFileAccess(event, invoiceCode, source, { config, objectKey })',
      'const signedUrl = await createSignedInvoiceFileUrl'
    )
    assert.doesNotMatch(viewRoute, /queryRow|queryRows|execute|useDbPool/)

    assert.match(listPreview, /params\.set\('code', code\)/)
    assert.match(editPage, /params\.set\('code', code\)/)
  })

  test('service API paths bypass ordinary user permission middleware', () => {
    const permissionMiddleware = readFileSync(new URL('../server/middleware/finance-permission.ts', import.meta.url), 'utf8')
    const tenantRuntimeMiddleware = readFileSync(new URL('../server/middleware/tenant-runtime.ts', import.meta.url), 'utf8')

    assert.match(permissionMiddleware, /path\.startsWith\('service\/'\)/)
    assertBefore(permissionMiddleware, 'path.startsWith(\'service/\')', 'resolveFinanceApiPermission(path, method')
    assertBefore(tenantRuntimeMiddleware, 'await requireForwardedServiceCapability(event)', 'maybeCallCurrentFinanceDataRuntime(event)')
    assert.match(tenantRuntimeMiddleware, /workflow\/callback/)
    assert.match(tenantRuntimeMiddleware, /maintenance-financial-summary/)
    assert.match(tenantRuntimeMiddleware, /people-cost-parameters/)
    assert.match(tenantRuntimeMiddleware, /performance-amounts/)
    assert.match(tenantRuntimeMiddleware, /apiPath === '\/api\/v1\/finance\/service\/people-cost-parameters'[\s\S]{0,140}allowedApps: \['people'\]/)
    assert.match(tenantRuntimeMiddleware, /apiPath === '\/api\/v1\/finance\/service\/performance-amounts'[\s\S]{0,140}allowedApps: \['people'\]/)
    assert.doesNotMatch(tenantRuntimeMiddleware, /allowedApps: \['people', 'finance'\]/)
    assert.match(tenantRuntimeMiddleware, /isFinanceServiceApiPath\(url\.pathname\)[\s\S]{0,160}Unsupported Finance service endpoint capability/)
  })

  test('Finance write APIs fail closed when tenant-runtime does not handle the request', () => {
    const dataRuntime = readFileSync(new URL('../server/utils/dataRuntime.ts', import.meta.url), 'utf8')
    const workflowCallback = readFileSync(new URL('../server/api/v1/finance/workflow/callback.post.ts', import.meta.url), 'utf8')

    assert.match(dataRuntime, /function isFinanceWriteMethod\(method: DataRuntimeMethod\)/)
    assert.match(dataRuntime, /!runtime\.handled && isFinanceWriteMethod\(normalizedMethod\)/)
    assert.match(dataRuntime, /statusCode:\s*503/)
    assert.match(dataRuntime, /Finance tenant-runtime is required for Finance write API mutations\./)
    assertBefore(
      dataRuntime,
      'if (!runtime.handled && isFinanceWriteMethod(normalizedMethod))',
      'return runtime'
    )

    assertBefore(
      workflowCallback,
      'maybeCallCurrentFinanceDataRuntime(event)',
      'throw createError'
    )
    assert.match(workflowCallback, /Finance tenant-runtime is required for workflow callbacks\./)
    assert.doesNotMatch(workflowCallback, /readBody/)
    assert.doesNotMatch(workflowCallback, /queryRow/)
    assert.doesNotMatch(workflowCallback, /execute/)
    assert.doesNotMatch(workflowCallback, /applyApprovalResult/)
    assert.doesNotMatch(workflowCallback, /approval_callback_log/)
    assert.doesNotMatch(workflowCallback, /external_approval_instance/)
  })

  test('Finance direct DB helper remains a fail-closed compatibility stub', () => {
    const db = readFileSync(new URL('../server/utils/db.ts', import.meta.url), 'utf8')

    assert.match(db, /function directDbDisabled\(\): never/)
    assert.match(db, /Finance direct DB access is disabled\. Route database operations through tenant-runtime\/data-runtime\./)
    assert.doesNotMatch(db, /mysql2|createPool|runtimeConfig\.db|process\.env\.DB_|DB_HOST|DB_USER|DB_PASSWORD/)

    for (const name of ['useDbPool', 'queryRows', 'queryRow', 'execute']) {
      assert.match(
        db,
        new RegExp(`export (?:async )?function ${name}[\\s\\S]{0,220}return directDbDisabled\\(\\)`),
        `${name} must delegate to directDbDisabled`
      )
    }
  })

  test('Finance approval submit cannot bypass Workflow with local or terminal metadata', () => {
    const dataRuntime = readFileSync(new URL('../server/utils/dataRuntime.ts', import.meta.url), 'utf8')
    const workflowUtil = readFileSync(new URL('../server/utils/financeWorkflow.ts', import.meta.url), 'utf8')
    const runtimeApproval = readFileSync(new URL('../../data-runtime/internal/apps/finance/write_approval.go', import.meta.url), 'utf8')
    const runtimeTest = readFileSync(new URL('../../data-runtime/internal/apps/finance/approval_duty_separation_test.go', import.meta.url), 'utf8')

    assert.match(dataRuntime, /sanitizeWorkflowSubmitPayload/)
    assert.match(dataRuntime, /Workflow approval instance is required before submitting Finance approval documents\./)
    assert.doesNotMatch(dataRuntime, /payload\.skipWorkflow/)
    assert.doesNotMatch(dataRuntime, /createLocalWorkflowFallback/)
    assert.doesNotMatch(workflowUtil, /createLocalWorkflowFallback/)
    assert.doesNotMatch(workflowUtil, /platform: 'workflow' \| 'local'/)
    assert.match(workflowUtil, /'x-hzy-request-app-code': 'finance'/)

    assert.match(runtimeApproval, /validateApprovalSubmissionWorkflowMetadata\(body\)/)
    assert.match(runtimeApproval, /workflow_instance_required/)
    assert.match(runtimeApproval, /workflow_platform_required/)
    assert.match(runtimeApproval, /approval_result_requires_workflow_callback/)
    assert.doesNotMatch(runtimeApproval, /workflowInstanceID = "finance-"/)
    assert.doesNotMatch(runtimeApproval, /status == "approved"[\s\S]{0,160}applyApprovalResultTx/)
    assert.match(runtimeTest, /TestApprovalSubmissionRequiresWorkflowInstance/)
    assert.match(runtimeTest, /TestApprovalSubmissionRejectsLocalWorkflowPlatform/)
    assert.match(runtimeTest, /TestApprovalSubmissionRejectsTerminalWorkflowStatus/)
  })

  test('approval request mutation handlers no longer keep Nuxt local DB fallbacks', () => {
    const approvalUtil = readFileSync(new URL('../server/utils/financeApproval.ts', import.meta.url), 'utf8')
    const mutationHandlers = [
      '../server/api/v1/finance/invoice-requests/index.post.ts',
      '../server/api/v1/finance/invoice-requests/[code]/index.patch.ts',
      '../server/api/v1/finance/invoice-requests/[code]/submit.post.ts',
      '../server/api/v1/finance/expense-claims/index.post.ts',
      '../server/api/v1/finance/expense-claims/[code]/index.patch.ts',
      '../server/api/v1/finance/expense-claims/[code]/submit.post.ts',
      '../server/api/v1/finance/project-expense-requests/index.post.ts',
      '../server/api/v1/finance/project-expense-requests/[code]/index.patch.ts',
      '../server/api/v1/finance/project-expense-requests/[code]/submit.post.ts',
      '../server/api/v1/finance/payment-requests/index.post.ts',
      '../server/api/v1/finance/payment-requests/[code]/index.patch.ts',
      '../server/api/v1/finance/payment-requests/[code]/submit.post.ts'
    ]

    for (const relativePath of mutationHandlers) {
      const content = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
      assert.match(content, /maybeCallCurrentFinanceDataRuntime\(event\)/, relativePath)
      assert.match(content, /statusCode:\s*503/, relativePath)
      assert.doesNotMatch(content, /readBody/, relativePath)
      assert.doesNotMatch(content, /queryRow|queryRows|execute|useDbPool/, relativePath)
      assert.doesNotMatch(content, /utils\/db/, relativePath)
      assert.doesNotMatch(content, /utils\/financeWrite/, relativePath)
      assert.doesNotMatch(content, /submitApproval/, relativePath)
    }

    assert.match(approvalUtil, /export const approvalTargets/)
    assert.doesNotMatch(approvalUtil, /utils\/db/)
    assert.doesNotMatch(approvalUtil, /queryRow|execute|useDbPool/)
    assert.doesNotMatch(approvalUtil, /submitApproval|applyApprovalResult|getApprovalRow/)
  })

  test('ledger mutation handlers no longer keep Nuxt local DB fallbacks', () => {
    const mutationHandlers = [
      '../server/api/v1/finance/invoices/index.post.ts',
      '../server/api/v1/finance/invoices/[code]/index.patch.ts',
      '../server/api/v1/finance/receipts/index.post.ts',
      '../server/api/v1/finance/receipts/[code]/index.patch.ts',
      '../server/api/v1/finance/receipts/[code]/classify.post.ts',
      '../server/api/v1/finance/expenses/index.post.ts',
      '../server/api/v1/finance/expenses/[code]/index.patch.ts'
    ]

    for (const relativePath of mutationHandlers) {
      const content = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
      assert.match(content, /maybeCallCurrentFinanceDataRuntime\(event\)/, relativePath)
      assert.match(content, /statusCode:\s*503/, relativePath)
      assert.doesNotMatch(content, /readBody/, relativePath)
      assert.doesNotMatch(content, /queryRow|queryRows|execute|useDbPool/, relativePath)
      assert.doesNotMatch(content, /utils\/db/, relativePath)
      assert.doesNotMatch(content, /utils\/financeWrite/, relativePath)
      assert.doesNotMatch(content, /recalculateContractSummary/, relativePath)
    }
  })

  test('all Finance mutation handlers avoid Nuxt local persistence fallbacks', () => {
    const mutationHandlers = listFiles(new URL('../server/api/v1/finance/', import.meta.url))
      .filter(file => /\.(post|patch|put|delete)\.ts$/.test(file.pathname))

    assert.ok(mutationHandlers.length > 0)

    for (const file of mutationHandlers) {
      const relativePath = decodeURIComponent(file.pathname.split('/finance/').at(-1) || file.pathname)
      const content = readFileSync(file, 'utf8')
      assert.doesNotMatch(content, /from ['"][^'"]*(?:utils\/db|utils\/finance(?:Audit|Calculation|Migration|Record|Summary|Write))['"]/, relativePath)
      assert.doesNotMatch(content, /\b(?:queryRow|queryRows|useDbPool|softDeleteFinanceRecord|recalculateContractSummary|runWizbizMigration)\b/, relativePath)
      assert.doesNotMatch(content, /\bexecute\s*\(/, relativePath)
    }
  })

  test('Finance mutation handlers are tenant-runtime driven unless explicitly local orchestration', () => {
    const mutationHandlers = listFiles(new URL('../server/api/v1/finance/', import.meta.url))
      .filter(file => /\.(post|patch|put|delete)\.ts$/.test(file.pathname))
    const localOrchestrationExceptions = new Map<RegExp, RegExp>([
      [/^authorization\/instance-conflict-explain\.post\.ts$/, /explainFinanceInstanceConflicts/],
      [/^invoices\/files\.post\.ts$/, /readMultipartFormData/],
      [/^workflow\/actions\/sync\.post\.ts$/, /syncApprovalActionsToWorkflow/],
      [/^integration-operations\/.+\.post\.ts$/, /callFinanceIntegrationOperationAdmin/]
    ])

    assert.ok(mutationHandlers.length > 0)

    for (const file of mutationHandlers) {
      const relativePath = decodeURIComponent(file.pathname.split('/finance/').at(-1) || file.pathname)
      const content = readFileSync(file, 'utf8')
      const exception = Array.from(localOrchestrationExceptions).find(([pattern]) => pattern.test(relativePath))

      if (exception) {
        assert.match(content, exception[1], relativePath)
        assert.doesNotMatch(content, /\b(?:queryRow|queryRows|useDbPool)\b/, relativePath)
        continue
      }

      assert.match(
        content,
        /maybeCallCurrentFinanceDataRuntime\(event\)|maybeCallFinanceDataRuntime/,
        `${relativePath} must call Finance tenant-runtime before mutating business facts`
      )
      assert.match(content, /statusCode:\s*503|statusMessage:\s*'Finance tenant-runtime is required/, relativePath)
    }
  })

  test('Finance list read handlers no longer keep Nuxt local DB fallbacks', () => {
    const listReadHandlers = [
      '../server/api/v1/finance/accounting-objects/index.get.ts',
      '../server/api/v1/finance/audit-logs/index.get.ts',
      '../server/api/v1/finance/employee-contributions/index.get.ts',
      '../server/api/v1/finance/employee-costs/index.get.ts',
      '../server/api/v1/finance/expense-claims/index.get.ts',
      '../server/api/v1/finance/expenses/index.get.ts',
      '../server/api/v1/finance/integrations/approval-instances.get.ts',
      '../server/api/v1/finance/invoice-requests/index.get.ts',
      '../server/api/v1/finance/invoices/index.get.ts',
      '../server/api/v1/finance/payment-requests/index.get.ts',
      '../server/api/v1/finance/performance-rules/index.get.ts',
      '../server/api/v1/finance/performance/index.get.ts',
      '../server/api/v1/finance/performance/snapshots/index.get.ts',
      '../server/api/v1/finance/project-accounting/index.get.ts',
      '../server/api/v1/finance/project-cost-allocations/index.get.ts',
      '../server/api/v1/finance/project-expense-requests/index.get.ts',
      '../server/api/v1/finance/receipts/index.get.ts',
      '../server/api/v1/finance/reconciliation/index.get.ts',
      '../server/api/v1/finance/settings/expense-types.get.ts',
      '../server/api/v1/finance/settings/income-types.get.ts',
      '../server/api/v1/finance/settings/subject-mappings.get.ts',
      '../server/api/v1/finance/settings/subjects.get.ts'
    ]

    for (const relativePath of listReadHandlers) {
      const content = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
      assert.match(content, /maybeCallCurrentFinanceDataRuntime\(event\)/, relativePath)
      assert.match(content, /statusCode:\s*503/, relativePath)
      assert.doesNotMatch(content, /listFinanceRows/, relativePath)
      assert.doesNotMatch(content, /queryRow|queryRows|execute|useDbPool/, relativePath)
      assert.doesNotMatch(content, /utils\/db/, relativePath)
      assert.doesNotMatch(content, /utils\/financeList/, relativePath)
    }
  })

  test('Finance detail read handlers no longer keep Nuxt local DB fallbacks', () => {
    const detailReadHandlers = [
      '../server/api/v1/finance/bank-accounts/[code]/index.get.ts',
      '../server/api/v1/finance/expense-claims/[code]/index.get.ts',
      '../server/api/v1/finance/expenses/[code]/index.get.ts',
      '../server/api/v1/finance/invoice-requests/[code]/index.get.ts',
      '../server/api/v1/finance/invoices/[code]/index.get.ts',
      '../server/api/v1/finance/payment-requests/[code]/index.get.ts',
      '../server/api/v1/finance/project-expense-requests/[code]/index.get.ts',
      '../server/api/v1/finance/receipts/[code]/index.get.ts'
    ]

    for (const relativePath of detailReadHandlers) {
      const content = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
      assert.match(content, /maybeCallCurrentFinanceDataRuntime\(event\)/, relativePath)
      assert.match(content, /statusCode:\s*503/, relativePath)
      assert.doesNotMatch(content, /getFinanceRecord/, relativePath)
      assert.doesNotMatch(content, /queryRow|queryRows|execute|useDbPool/, relativePath)
      assert.doesNotMatch(content, /utils\/db/, relativePath)
      assert.doesNotMatch(content, /utils\/financeRecord/, relativePath)
    }
  })

  test('Finance server code no longer keeps Nuxt local DB fallback helpers', () => {
    const removedHelpers = [
      '../server/middleware/finance-audit.ts',
      '../server/utils/financeAudit.ts',
      '../server/utils/financeCalculation.ts',
      '../server/utils/financeList.ts',
      '../server/utils/financeMigration.ts',
      '../server/utils/financeRecord.ts',
      '../server/utils/financeReports.ts',
      '../server/utils/financeSummary.ts',
      '../server/utils/financeWrite.ts'
    ]

    for (const relativePath of removedHelpers) {
      assert.equal(existsSync(new URL(relativePath, import.meta.url)), false, relativePath)
    }

    const serverFiles = listFiles(new URL('../server/', import.meta.url))
      .filter(file => file.pathname.endsWith('.ts'))
      .filter(file => !file.pathname.endsWith('/server/utils/db.ts'))

    assert.ok(serverFiles.length > 0)

    for (const file of serverFiles) {
      const relativePath = decodeURIComponent(file.pathname.split('/finance/').at(-1) || file.pathname)
      const content = readFileSync(file, 'utf8')
      assert.doesNotMatch(content, /from ['"][^'"]*(?:utils\/db|utils\/finance(?:Audit|Calculation|List|Migration|Record|Reports|Summary|Write))['"]/, relativePath)
      assert.doesNotMatch(content, /\b(?:queryRow|queryRows|useDbPool|listFinanceRows|getFinanceRecord|monthlyFinanceReport|projectFinanceDetail|runWizbizMigration|recalculateContractSummary|submitApproval|applyApprovalResult|getApprovalRow)\b/, relativePath)
      assert.doesNotMatch(content, /\b(?:approval_callback_log|external_approval_instance)\b/, relativePath)
      assert.doesNotMatch(content, /\bexecute\s*\(/, relativePath)
    }
  })

  test('recommended roles isolate sensitive approval and confirmation actions', () => {
    assert.ok(rolePermissions('finance:invoice_approver').includes('finance:invoices:approve'))
    assert.ok(rolePermissions('finance:expense_approver').includes('finance:expenses:approve'))
    assert.ok(rolePermissions('finance:cashier').includes('finance:receipts:confirm'))
    assert.ok(rolePermissions('finance:cashier').includes('finance:expenses:confirm'))
    assert.ok(rolePermissions('finance:reconciliation_operator').includes('finance:reconciliation:confirm'))

    for (const code of ['finance:accountant', 'finance:manager']) {
      const permissions = rolePermissions(code)
      assert.equal(permissions.includes('finance:invoices:approve'), false, `${code} should not include invoices:approve`)
      assert.equal(permissions.includes('finance:expenses:approve'), false, `${code} should not include expenses:approve`)
      assert.equal(permissions.includes('finance:expenses:confirm'), false, `${code} should not include expenses:confirm`)
      assert.equal(permissions.includes('finance:receipts:confirm'), false, `${code} should not include receipts:confirm`)
      assert.equal(permissions.includes('finance:reconciliation:confirm'), false, `${code} should not include reconciliation:confirm`)
    }

    const adminPermissions = rolePermissions('finance:admin')
    for (const permission of [
      'finance:dashboard:export',
      'finance:invoices:approve',
      'finance:receipts:confirm',
      'finance:expenses:approve',
      'finance:expenses:confirm',
      'finance:reconciliation:confirm',
      'finance:reports:export'
    ]) {
      assert.ok(adminPermissions.includes(permission), `finance:admin must include ${permission}`)
    }
  })
})
