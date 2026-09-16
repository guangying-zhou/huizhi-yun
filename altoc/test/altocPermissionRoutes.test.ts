import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveAltocApiPermission } from '../server/utils/altocPermissionRoutes.ts'
import { resources as manifestResources } from '../app/config/permissions.ts'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)
  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

function assertIncludes(content: string, snippet: string) {
  assert.ok(content.includes(snippet), `Missing ${snippet}`)
}

describe('resolveAltocApiPermission sensitive action mapping', () => {
  test('quotation approval requires quotation/approve', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/quotes/42/approve', 'POST', 'approve'),
      { resource: 'quotation', action: 'approve' }
    )
  })

  test('contract status approve or reject requires contract/approve', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/status', 'POST', 'approve'),
      { resource: 'contract', action: 'approve' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/status', 'POST', 'reject'),
      { resource: 'contract', action: 'approve' }
    )
  })

  test('contract status submit still requires contract/edit', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/status', 'POST', 'submit'),
      { resource: 'contract', action: 'edit' }
    )
  })

  test('payment confirmation requires receivable/confirm', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/payments/7/confirm', 'POST'),
      { resource: 'receivable', action: 'confirm' }
    )
  })

  test('exact-code payment detail uses view while mutation stays edit', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/payments/RP-EXACT-1', 'GET'),
      { resource: 'receivable', action: 'view' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/payments/RP-EXACT-1', 'PUT'),
      { resource: 'receivable', action: 'edit' }
    )
  })

  test('instance conflict explanation defaults to a local read guard mapping', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/authorization/instance-conflict-explain', 'POST'),
      { resource: 'receivable', action: 'view' }
    )
  })

  test('billable sync requires receivable/mark-billable', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/service/receivable-plans/RP-1/mark-billable', 'POST'),
      { resource: 'receivable', action: 'mark-billable' }
    )
  })

  test('customer delivery asset status sync requires contract service scope', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/service/customer-delivery-assets/CDA-1/status:sync', 'POST'),
      { resource: 'contract', action: 'delivery-asset-status:sync' }
    )
  })

  test('service ticket close requires service_ticket/close', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/service-tickets/ST-1', 'PATCH', 'closed'),
      { resource: 'service_ticket', action: 'close' }
    )
  })

  test('ordinary service ticket update remains service_ticket/edit', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/service-tickets/ST-1', 'PATCH', 'processing'),
      { resource: 'service_ticket', action: 'edit' }
    )
  })

  test('document links map entity type to the owning resource', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/documents/99', 'DELETE', '', 'tender'),
      { resource: 'quotation', action: 'edit' }
    )
  })

  test('document runtime paths require supported entity type before transport-scope fallback', () => {
    const content = source('server/middleware/tenant-runtime.ts')

    assert.match(content, /function assertSupportedDocumentRuntimeEntityType\(context: TenantRuntimeProxyContext, entityType: string\)/)
    assert.match(content, /Altoc document runtime paths require supported entity_type before tenant-runtime forwarding\./)
    assertBefore(
      content,
      'assertSupportedDocumentRuntimeEntityType(context, entityType)',
      'const rule = resolveAltocApiPermission'
    )
    assertBefore(
      content,
      'assertSupportedDocumentRuntimeEntityType(context, entityType)',
      'if (!resource || !action) return transportScope'
    )
    assert.match(content, /if \(!\/\^\\\/documents\(\\\/\[\^\/\]\+\)\?\$\/\.test\(context\.suffix\)\) return/)
    assert.match(content, /if \(documentRuntimeResource\(context, entityType\)\) return/)
  })

  test('legacy attachment endpoints are retired instead of using local file or DB access', () => {
    const readRoute = source('server/api/v1/attachments/index.get.ts')
    const writeRoute = source('server/api/v1/attachments/index.post.ts')

    assert.equal(resolveAltocApiPermission('/attachments', 'GET'), null)
    assert.equal(resolveAltocApiPermission('/attachments', 'POST'), null)
    for (const content of [readRoute, writeRoute]) {
      assert.match(content, /statusCode:\s*503/)
      assert.match(content, /runtime-backed document links/)
      assert.doesNotMatch(content, /readBody|readMultipartFormData|useDbPool|queryRows?|execute|createSigned|getObject|putObject|OSS/)
    }
  })

  test('tender paths use quotation scoped data access before runtime forwarding', () => {
    const content = source('server/middleware/tenant-runtime.ts')

    assert.deepEqual(
      resolveAltocApiPermission('/tenders', 'GET'),
      { resource: 'quotation', action: 'view' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/tenders/42/milestones', 'POST'),
      { resource: 'quotation', action: 'edit' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/tenders/42/members', 'DELETE'),
      { resource: 'quotation', action: 'edit' }
    )
    assertIncludes(content, '\'quotation\',')
    assertIncludes(content, '{ prefix: \'/tenders\', resource: \'quotation\' }')
    assert.match(content, /resolveAltocDataAccessQuery\([\s\S]+rule\.resource,[\s\S]+rule\.action/)
  })

  test('tenant-runtime scope and data access derive command and entity context from body', () => {
    const content = source('server/middleware/tenant-runtime.ts')

    assert.match(content, /function runtimeEntityTypeFromContext\(context: TenantRuntimeProxyContext\)/)
    assert.match(content, /function runtimeCommandFromContext\(context: TenantRuntimeProxyContext\)/)
    assert.match(content, /body\.entity_type/)
    assert.match(content, /body\.entityType/)
    assert.match(content, /body\.status/)
    assert.match(content, /body\.action/)
    assert.match(content, /resolveAltocApiPermission\(context\.suffix, context\.method, runtimeCommandFromContext\(context\), entityType\)/)
  })

  test('read-only shared config lists do not require settings permission', () => {
    assert.equal(resolveAltocApiPermission('/config/industries', 'GET'), null)
    assert.equal(resolveAltocApiPermission('/config/contract-business-templates', 'GET'), null)
  })

  test('dashboard reads remain view but export-style paths require dashboard/export', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/dashboard/summary', 'GET'),
      { resource: 'dashboard', action: 'view' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/dashboard/export', 'GET'),
      { resource: 'dashboard', action: 'export' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/dashboard/receivables/download', 'GET'),
      { resource: 'dashboard', action: 'export' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/dashboard/funnel/csv', 'GET'),
      { resource: 'dashboard', action: 'export' }
    )
  })

  test('non-manifest export-style business paths fail closed instead of downgrading to view', () => {
    for (const path of [
      '/customers/export',
      '/opportunities/download',
      '/quotes/42/xlsx',
      '/contracts/csv',
      '/payments/export'
    ]) {
      assert.deepEqual(
        resolveAltocApiPermission(path, 'GET'),
        { resource: 'unsupported_export', action: 'admin' },
        `${path} must not be treated as an ordinary view route`
      )
    }
  })

  test('export-style route mapping stays aligned with manifest export actions', () => {
    const exportableResources = manifestResources
      .filter(resource => resource.actions.includes('export'))
      .map(resource => resource.code)

    assert.deepEqual(exportableResources, ['dashboard'])
    assert.deepEqual(
      resolveAltocApiPermission('/dashboard/xlsx', 'GET'),
      { resource: 'dashboard', action: 'export' }
    )
  })

  test('Goal 3 analytics paths use dashboard view permission and dedicated runtime prefix', () => {
    const content = source('server/middleware/tenant-runtime.ts')

    assert.deepEqual(
      resolveAltocApiPermission('/altoc/analytics/contract/CON-1', 'GET'),
      { resource: 'dashboard', action: 'view' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/analytics/customer/CU-1', 'GET'),
      { resource: 'dashboard', action: 'view' }
    )
    assertIncludes(content, 'apiPrefix: `${API_PREFIX}/altoc`')
    assertIncludes(content, 'if (context.method === \'GET\' && /^\\/analytics\\/(contract|customer)\\/[^/]+$/.test(context.suffix)) return true')
    assertBefore(content, 'const analyticsRuntimeResponse = await maybeProxyCurrentApiToTenantRuntime', 'const runtimeResponse = await maybeProxyCurrentApiToTenantRuntime')
  })

  test('customer approval status write requires customer/approve while submit remains edit', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/customers/42', 'PUT', 'approved'),
      { resource: 'customer', action: 'approve' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/customers/42', 'PATCH', 'approved'),
      { resource: 'customer', action: 'approve' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/customers/42', 'PUT', 'approval_pending'),
      { resource: 'customer', action: 'edit' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/customers/42', 'PUT', 'draft'),
      { resource: 'customer', action: 'edit' }
    )
  })

  test('contract lines use contract permissions', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/lines', 'POST'),
      { resource: 'contract', action: 'edit' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/lines/7', 'GET'),
      { resource: 'contract', action: 'view' }
    )
  })

  test('P0B contract lifecycle commands use contract permissions', () => {
    for (const command of ['submit', 'withdraw', 'mark-signed', 'suspend', 'terminate']) {
      assert.deepEqual(
        resolveAltocApiPermission(`/contracts/42/${command}`, 'POST'),
        { resource: 'contract', action: 'edit' }
      )
    }
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/fulfillment/close', 'POST'),
      { resource: 'contract', action: 'edit' }
    )
  })

  test('P0B obligation commands use contract permissions', () => {
    for (const command of ['start', 'submit', 'accept', 'reject']) {
      assert.deepEqual(
        resolveAltocApiPermission(`/contract-obligations/7/${command}`, 'POST'),
        { resource: 'contract', action: 'edit' }
      )
    }
  })

  test('P0B obligation and billing subresources use contract permissions', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/obligations', 'GET'),
      { resource: 'contract', action: 'view' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/billing-schedules', 'GET'),
      { resource: 'contract', action: 'view' }
    )
  })

  test('P1A activation and project link routes use contract permissions', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/activation-plan', 'GET'),
      { resource: 'contract', action: 'view' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/activation/execute', 'POST'),
      { resource: 'contract', action: 'edit' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/activation/jobs/7/retry', 'POST'),
      { resource: 'contract', action: 'edit' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/project-links', 'POST'),
      { resource: 'contract', action: 'edit' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/delivery-asset-plans', 'GET'),
      { resource: 'contract', action: 'view' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/service-agreements', 'GET'),
      { resource: 'contract', action: 'view' }
    )
  })

  test('service agreement project relation APIs use contract permissions', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/service/service-agreements/SA-1/project-relations', 'GET'),
      { resource: 'contract', action: 'view' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/service/service-agreements/SA-1/project-relations', 'POST'),
      { resource: 'contract', action: 'edit' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/service/service-agreements/SA-1/default-project', 'GET'),
      { resource: 'contract', action: 'view' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/service/projects/PRJ-1/contract-lines', 'GET'),
      { resource: 'contract', action: 'view' }
    )
  })

  test('service agreement project relation APIs require service capability before tenant-runtime proxy', () => {
    const content = source('server/middleware/tenant-runtime.ts')

    assertBefore(content, 'await requireForwardedServiceCapability(event)', 'maybeProxyCurrentApiToTenantRuntime(event')
    assert.match(content, /function serviceCapabilityRequirement\(suffix: string, method: string\)/)
    assert.match(content, /\/\^\\\/service\\\/service-agreements\\\/\[\^\/\]\+\\\/project-relations\$\/\.test\(suffix\)[\s\S]{0,120}scope: 'altoc:read'[\s\S]{0,80}allowedApps: \['altoc', 'aims', 'finance'\]/)
    assert.match(content, /\/\^\\\/service\\\/service-agreements\\\/\[\^\/\]\+\\\/default-project\$\/\.test\(suffix\)[\s\S]{0,120}scope: 'altoc:read'[\s\S]{0,80}allowedApps: \['altoc', 'aims', 'finance'\]/)
    assert.match(content, /\/\^\\\/service\\\/service-agreement-projects\\\/by-project\\\/\[\^\/\]\+\$\/\.test\(suffix\)[\s\S]{0,120}scope: 'altoc:read'[\s\S]{0,80}allowedApps: \['altoc', 'aims', 'finance'\]/)
    assert.match(content, /\/\^\\\/service\\\/projects\\\/\[\^\/\]\+\\\/contract-lines\$\/\.test\(suffix\)[\s\S]{0,120}scope: 'altoc:read'[\s\S]{0,80}allowedApps: \['finance', 'aims', 'altoc'\]/)
    assert.match(content, /\/\^\\\/service\\\/service-agreements\\\/\[\^\/\]\+\\\/project-relations\$\/\.test\(suffix\)[\s\S]{0,120}scope: 'altoc:contract:edit'[\s\S]{0,80}allowedApps: \['altoc'\]/)
    assert.match(content, /\/\^\\\/service\\\/service-agreements\\\/\[\^\/\]\+\\\/project-relations\\\/default\$\/\.test\(suffix\)[\s\S]{0,120}scope: 'altoc:contract:edit'[\s\S]{0,80}allowedApps: \['altoc'\]/)
    assert.match(content, /\/\^\\\/service\\\/service-agreements\\\/\[\^\/\]\+\\\/project-relations\\\/\[\^\/\]\+:\(end\|suspend\)\$\/\.test\(suffix\)[\s\S]{0,120}scope: 'altoc:contract:edit'[\s\S]{0,80}allowedApps: \['altoc'\]/)
  })

  test('unknown service-only Altoc paths are rejected before tenant-runtime proxy', () => {
    const content = source('server/middleware/tenant-runtime.ts')

    assertBefore(content, 'await requireForwardedServiceCapability(event)', 'maybeProxyCurrentApiToTenantRuntime(event')
    assert.match(content, /function isAllowedLocalUserServicePath\(suffix: string, method: string\)/)
    assert.match(content, /\/\^\\\/service\\\/contracts\\\/\[\^\/\]\+\\\/activate-delivery\$\/\.test\(suffix\)/)
    assert.match(content, /suffix\.startsWith\('\/service\/'\)[\s\S]{0,120}!isAllowedLocalUserServicePath\(suffix, method\)[\s\S]{0,160}Unsupported Altoc service endpoint capability/)
  })

  test('Goal 3 operating accounting service APIs use contract permissions', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/service/contract-lines/CL-1/cost-allocations', 'GET'),
      { resource: 'contract', action: 'view' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/service/contract-lines/CL-1/cost-allocations', 'POST'),
      { resource: 'contract', action: 'edit' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/service/contract-lines/CL-1/profit-summary:freeze', 'POST'),
      { resource: 'contract', action: 'edit' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/service/contracts/CON-1/profit-summary:recalculate', 'POST'),
      { resource: 'contract', action: 'edit' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/service/service-agreements/SA-1/cost-summary', 'GET'),
      { resource: 'contract', action: 'view' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/service/service-agreements/SA-1/cost-summary:recalculate', 'POST'),
      { resource: 'contract', action: 'edit' }
    )
  })

  test('Goal 3 operating accounting service APIs forward and require service capability', () => {
    const content = source('server/middleware/tenant-runtime.ts')

    assertBefore(content, 'await requireForwardedServiceCapability(event)', 'maybeProxyCurrentApiToTenantRuntime(event')
    assertIncludes(content, 'if (/^\\/service\\/contract-lines\\/[^/]+\\/cost-allocations$/.test(context.suffix)) return context.method === \'GET\' || context.method === \'POST\'')
    assertIncludes(content, 'if (/^\\/service\\/contract-lines\\/[^/]+\\/profit-summary:freeze$/.test(context.suffix)) return context.method === \'POST\'')
    assertIncludes(content, 'if (/^\\/service\\/contracts\\/[^/]+\\/profit-summary:recalculate$/.test(context.suffix)) return context.method === \'POST\'')
    assertIncludes(content, 'if (/^\\/service\\/service-agreements\\/[^/]+\\/cost-summary$/.test(context.suffix)) return context.method === \'GET\'')
    assertIncludes(content, 'if (/^\\/service\\/service-agreements\\/[^/]+\\/cost-summary:recalculate$/.test(context.suffix)) return context.method === \'POST\'')
    assertIncludes(content, 'return { scope: \'altoc:read\', allowedApps: [\'finance\', \'aims\', \'altoc\'] }')
    assertIncludes(content, 'return { scope: \'altoc:contract:edit\', allowedApps: [\'finance\', \'aims\', \'altoc\'] }')
    assertIncludes(content, 'return { scope: \'altoc:contract:edit\', allowedApps: [\'finance\', \'altoc\'] }')
  })

  test('service agreement coverage APIs use contract permissions', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/service/service-agreements/SA-1/coverages', 'GET'),
      { resource: 'contract', action: 'view' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/service/service-agreements/SA-1/coverages', 'POST'),
      { resource: 'contract', action: 'edit' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/service/service-agreements/SA-1/coverages/SAC-1:resolve', 'POST'),
      { resource: 'contract', action: 'edit' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/service/service-agreement-coverages/by-environment/ENV-1', 'GET'),
      { resource: 'contract', action: 'view' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/service/service-agreement-coverages/by-delivery-asset/CDA-1', 'GET'),
      { resource: 'contract', action: 'view' }
    )
  })

  test('service agreement coverage APIs require service capability before local or runtime handling', () => {
    const content = source('server/middleware/tenant-runtime.ts')
    const createRoute = source('server/api/v1/service/service-agreements/[serviceAgreementCode]/coverages.post.ts')
    const commandRoute = source('server/api/v1/service/service-agreements/[serviceAgreementCode]/coverages/[coverageCommand].post.ts')

    assertBefore(content, 'await requireForwardedServiceCapability(event)', 'maybeProxyCurrentApiToTenantRuntime(event')
    assertBefore(
      content,
      'await requireForwardedServiceCapability(event)',
      'if (isAllowedNuxtApiV1Path(pathname, event.node.req.method || \'GET\', event)) return'
    )
    assertIncludes(content, 'if (/^\\/service\\/service-agreements\\/[^/]+\\/coverages$/.test(context.suffix)) return context.method === \'GET\'')
    assertIncludes(content, 'if (/^\\/service\\/service-agreements\\/[^/]+\\/coverages\\/[^/]+:(resolve|suspend|end|confirm-legacy)$/.test(context.suffix)) return false')
    assertIncludes(content, 'if (/^\\/service\\/service-agreement-coverages\\/by-(environment|delivery-asset)\\/[^/]+$/.test(context.suffix)) return context.method === \'GET\'')
    assert.match(content, /method === 'GET' && \/\^\\\/service\\\/service-agreements\\\/\[\^\/\]\+\\\/coverages\$\/\.test\(suffix\)[\s\S]{0,120}scope: 'altoc:read'[\s\S]{0,90}allowedApps: \['assets', 'aims', 'finance', 'altoc'\]/)
    assert.match(content, /method === 'GET' && \/\^\\\/service\\\/service-agreement-coverages\\\/by-\(environment\|delivery-asset\)\\\/\[\^\/\]\+\$\/\.test\(suffix\)[\s\S]{0,120}scope: 'altoc:read'[\s\S]{0,90}allowedApps: \['assets', 'aims', 'finance', 'altoc'\]/)
    assert.match(content, /\/\^\\\/service\\\/service-agreements\\\/\[\^\/\]\+\\\/coverages\$\/\.test\(suffix\)[\s\S]{0,120}scope: 'altoc:contract:edit'[\s\S]{0,90}allowedApps: \['assets', 'aims', 'altoc'\]/)
    assert.match(content, /\/\^\\\/service\\\/service-agreements\\\/\[\^\/\]\+\\\/coverages\\\/\[\^\/\]\+:\(resolve\|suspend\|end\|confirm-legacy\)\$\/\.test\(suffix\)[\s\S]{0,120}scope: 'altoc:contract:edit'[\s\S]{0,90}allowedApps: \['assets', 'aims', 'altoc'\]/)
    assert.match(content, /normalizedMethod === 'POST' && \/\^\\\/api\\\/v1\\\/service\\\/service-agreements\\\/\[\^\/\]\+\\\/coverages\$\/\.test\(apiPath\)/)
    assert.match(content, /normalizedMethod === 'POST' && \/\^\\\/api\\\/v1\\\/service\\\/service-agreements\\\/\[\^\/\]\+\\\/coverages\\\/\[\^\/\]\+:\(resolve\|suspend\|end\|confirm-legacy\)\$\/\.test\(apiPath\)/)
    assert.match(createRoute, /handleServiceAgreementCoverageWrite\(event,\s*\{\s*agreementCode\s*\}\)/)
    assert.match(commandRoute, /handleServiceAgreementCoverageWrite\(event,\s*\{\s*agreementCode,\s*coverageCommand\s*\}\)/)
  })
})
