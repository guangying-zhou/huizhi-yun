import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { callEnterpriseRuntime, capEnterpriseRuntimePermitExpiries, enterpriseHostDomainCapabilityForPath, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '../server/utils/enterpriseRuntimeClient.ts'
import { enterpriseDocumentPermitCanonical, enterpriseAltocReadPermitCanonical, enterpriseTimesheetReviewPermitCanonical, enterpriseTimesheetReviewWriteCanonical } from '../server/utils/tenantRuntimeClient.ts'
import { setLocalServiceTokenIssuer } from '../server/utils/serviceOidc.ts'

const globals = globalThis as { useRuntimeConfig?: () => unknown }
const originalConfig = globals.useRuntimeConfig
afterEach(() => {
  globals.useRuntimeConfig = originalConfig
  setLocalServiceTokenIssuer(null)
})
const user = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
const eventFor = (auth = user) => ({
  context: { consoleAuth: auth },
  node: { req: { headers: { 'host': 'host.test', 'x-hzy-actor-uid': 'forged', 'x-hzy-tenant': 'tenant-b', 'x-hzy-app-code': 'aims' }, url: '/assets/api/v1/product-directory?tenant=forged' } }
}) as never

test('Enterprise Host scope derives only from bounded registered path domains', () => {
  for (const [domain, path] of [
    ['aims', '/v1/enterprise/aims/projects:list'],
    ['assets', '/v1/enterprise/assets/products:list'],
    ['codocs', '/v1/enterprise/codocs/personal-documents:list'],
    ['altoc', '/v1/enterprise/altoc/customers:list'],
    ['console', '/v1/enterprise/console/directory-self:projects'],
    ['console', '/v1/enterprise/console/directory-self:accessible-departments']
  ]) assert.equal(enterpriseHostDomainCapabilityForPath(path), `${domain}:enterprise-host:execute`)
  for (const path of ['/v1/enterprise/finance/items:list', '/v1/enterprise/aims/', '/v1/enterprise/aims/projects:list/extra', '/v1/enterprise/aims/projects:list?scope=admin']) {
    assert.throws(() => enterpriseHostDomainCapabilityForPath(path))
  }
})

test('timesheet review write canonical matches the Go fixture, including Unicode and row version', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/enterprise-time-entry-review-write.json', import.meta.url), 'utf8'))
  const canonical = enterpriseTimesheetReviewWriteCanonical(fixture.method, fixture.target, fixture.actor, fixture.tenant, fixture.deployment, fixture.projectId, fixture.payload, fixture.key)
  assert.equal(canonical, fixture.canonical)
  assert.equal(createHmac('sha256', fixture.token).update(canonical).digest('base64url'), fixture.signature)
})

for (const [operation, path] of [
  ['console.directory-self-accessible-departments', '/v1/enterprise/console/directory-self:accessible-departments'],
  ['aims.time-entry-review-list', '/v1/enterprise/aims/time-entry-reviews:list'],
  ['codocs.personal-document-update-plan', '/v1/enterprise/codocs/personal-documents:update-plan'],
  ['codocs.personal-document-update', '/v1/enterprise/codocs/personal-documents:update'],
  ['codocs.department-documents-collaboration-open', '/v1/enterprise/codocs/department-documents:collaboration-open'],
  ['codocs.department-documents-snapshot-read', '/v1/enterprise/codocs/department-documents:snapshot-read'],
  ['codocs.department-documents-snapshot-prepare', '/v1/enterprise/codocs/department-documents:snapshot-prepare'],
  ['codocs.department-documents-snapshot-publish', '/v1/enterprise/codocs/department-documents:snapshot-publish'],
  ['codocs.department-documents-versions', '/v1/enterprise/codocs/department-documents:versions'],
  ['codocs.department-documents-version-view', '/v1/enterprise/codocs/department-documents:version-view'],
  ['altoc.customer-list', '/v1/enterprise/altoc/customers:list'],
  ['altoc.customer-view', '/v1/enterprise/altoc/customers:view'],
  ['altoc.contract-list', '/v1/enterprise/altoc/contracts:list'],
  ['altoc.contract-view', '/v1/enterprise/altoc/contracts:view'],
  ['altoc.receivable-list', '/v1/enterprise/altoc/receivable-plans:list'],
  ['altoc.receivable-view', '/v1/enterprise/altoc/receivable-plans:view'],
  ['altoc.lead-list', '/v1/enterprise/altoc/leads:list'],
  ['altoc.lead-view', '/v1/enterprise/altoc/leads:view'],
  ['altoc.opportunity-list', '/v1/enterprise/altoc/opportunities:list'],
  ['altoc.opportunity-view', '/v1/enterprise/altoc/opportunities:view'],
  ['altoc.quotation-list', '/v1/enterprise/altoc/quotations:list'],
  ['altoc.quotation-view', '/v1/enterprise/altoc/quotations:view'],
  ['altoc.contracts-activate-delivery', '/v1/enterprise/altoc/contracts:activate-delivery'],
  ['assets.products-link-base', '/v1/enterprise/assets/products:link-base'],
  ['assets.products-link-asset', '/v1/enterprise/assets/products:link-asset'],
  ['assets.products-link-document', '/v1/enterprise/assets/products:link-document'],
  ['assets.products-base-candidates', '/v1/enterprise/assets/products:base-candidates'],
  ['assets.products-asset-candidates', '/v1/enterprise/assets/products:asset-candidates'],
  ['assets.products-list', '/v1/enterprise/assets/products:list'],
  ['assets.products-view', '/v1/enterprise/assets/products:view'],
  ['assets.product-dictionaries', '/v1/enterprise/assets/product-dictionaries:list'],
  ['assets.product-categories', '/v1/enterprise/assets/product-categories:list'],
  ['assets.asset-dictionaries', '/v1/enterprise/assets/dictionaries:list'],
  ['assets.asset-items-list', '/v1/enterprise/assets/assets:list'],
  ['assets.asset-items-view', '/v1/enterprise/assets/assets:view'],
  ['assets.digital-assets-list', '/v1/enterprise/assets/digital-assets:list'],
  ['assets.digital-assets-view', '/v1/enterprise/assets/digital-assets:view'],
  ['assets.ip-assets-list', '/v1/enterprise/assets/ip-assets:list'],
  ['assets.ip-assets-view', '/v1/enterprise/assets/ip-assets:view'],
  ['assets.ip-assets-products', '/v1/enterprise/assets/ip-assets:products'],
  ['assets.ip-assets-create', '/v1/enterprise/assets/ip-assets:create'],
  ['assets.ip-assets-edit', '/v1/enterprise/assets/ip-assets:edit'],
  ['assets.ip-assets-link-product', '/v1/enterprise/assets/ip-assets:link-product'],
  ['assets.digital-assets-create', '/v1/enterprise/assets/digital-assets:create'],
  ['assets.digital-assets-edit', '/v1/enterprise/assets/digital-assets:edit'],
  ['assets.products-create', '/v1/enterprise/assets/products:create'],
  ['assets.products-edit', '/v1/enterprise/assets/products:edit'],
  ['assets.product-categories-admin', '/v1/enterprise/assets/product-categories:admin-list'],
  ['assets.product-categories-save', '/v1/enterprise/assets/product-categories:save'],

  ['aims.handoff-detail', '/v1/enterprise/aims/handoff:detail'],
  ['aims.handoff-projects', '/v1/enterprise/aims/handoff:projects'],
  ['aims.handoff-requirements', '/v1/enterprise/aims/handoff:requirements'],
  ['aims.handoff-project-authorization', '/v1/enterprise/aims/handoff:project-authorization'],
  ['aims.handoff-create', '/v1/enterprise/aims/handoff:create'],
  ['aims.version-execution-coordination', '/v1/enterprise/aims/product-version:execution-coordination'],
  ['aims.version-scope-list', '/v1/enterprise/aims/product-version:scope-list'],
  ['aims.version-scope-history', '/v1/enterprise/aims/product-version:scope-history'],
  ['aims.version-scope-edit', '/v1/enterprise/aims/product-version:scope-edit'],
  ['aims.version-scope-visibility', '/v1/enterprise/aims/product-version:scope-visibility'],
  ['aims.version-scope-legacy-criteria', '/v1/enterprise/aims/product-version:scope-legacy-criteria'],

  ['aims.version-acceptance-list', '/v1/enterprise/aims/product-version:acceptance-list'],
  ['aims.version-acceptance-view', '/v1/enterprise/aims/product-version:acceptance-view'],
  ['aims.version-release-list', '/v1/enterprise/aims/product-version:release-list'],
  ['aims.version-release-view', '/v1/enterprise/aims/product-version:release-view'],

  ['aims.feature-cycles', '/v1/enterprise/aims/features:cycles'],
  ['aims.feature-list', '/v1/enterprise/aims/features:list'],
  ['aims.feature-view', '/v1/enterprise/aims/features:view'],
  ['aims.feature-create', '/v1/enterprise/aims/features:create'],
  ['aims.feature-edit', '/v1/enterprise/aims/features:edit'],
  ['aims.feature-delete', '/v1/enterprise/aims/features:delete'],
  ['aims.feature-component-assign', '/v1/enterprise/aims/features:component-assign'],
  ['aims.feature-lifecycle', '/v1/enterprise/aims/features:lifecycle'],
  ['aims.feature-request-list', '/v1/enterprise/aims/features:request-list'],
  ['aims.feature-request-link', '/v1/enterprise/aims/features:request-link'],
  ['aims.feature-roadmap', '/v1/enterprise/aims/features:roadmap'],
  ['aims.feature-unscheduled', '/v1/enterprise/aims/features:unscheduled'],

  ['aims.component-create', '/v1/enterprise/aims/components:create'],
  ['aims.component-edit', '/v1/enterprise/aims/components:edit'],
  ['aims.component-move', '/v1/enterprise/aims/components:move'],
  ['aims.component-delete', '/v1/enterprise/aims/components:delete'],
  ['aims.onboard-candidates', '/v1/enterprise/aims/product-onboard:candidates'],
  ['aims.onboard-candidate', '/v1/enterprise/aims/product-onboard:candidate'],
  ['aims.onboard-line-candidates', '/v1/enterprise/aims/product-line-onboard:candidates'],
  ['aims.product-onboard', '/v1/enterprise/aims/product-onboard'],
  ['aims.product-line-onboard', '/v1/enterprise/aims/product-line-onboard'],
  ['aims.request-merge', '/v1/enterprise/aims/product-requests:merge'],
  ['aims.request-edit', '/v1/enterprise/aims/product-requests:edit'],
  ['aims.request-decide', '/v1/enterprise/aims/product-requests:decide'],
  ['aims.request-source-list', '/v1/enterprise/aims/request-sources:list'],
  ['aims.request-source-create', '/v1/enterprise/aims/request-sources:create'],
  ['aims.request-source-delete', '/v1/enterprise/aims/request-sources:delete'],
  ['aims.version-plan', '/v1/enterprise/aims/versions:plan'],
  ['aims.version-plan-items', '/v1/enterprise/aims/versions:plan-items'],
  ['aims.version-list', '/v1/enterprise/aims/versions:list'],
  ['aims.version-view', '/v1/enterprise/aims/versions:view'],
  ['aims.version-create', '/v1/enterprise/aims/versions:create'],
  ['aims.version-plan-edit', '/v1/enterprise/aims/versions:plan-edit'],
  ['aims.version-plan-item-create', '/v1/enterprise/aims/versions:plan-item-create'],
  ['aims.version-plan-item-edit', '/v1/enterprise/aims/versions:plan-item-edit'],
  ['aims.version-plan-item-delete', '/v1/enterprise/aims/versions:plan-item-delete'],
  ['aims.version-plan-confirm', '/v1/enterprise/aims/versions:plan-confirm'],
  ['aims.product-list', '/v1/enterprise/aims/product-list'],
  ['aims.component-list', '/v1/enterprise/aims/components:list'],
  ['aims.product-workspace-view', '/v1/enterprise/aims/product-workspace:view'],
  ['aims.project-list', '/v1/enterprise/aims/projects:list'],
  ['aims.project-view', '/v1/enterprise/aims/projects:view'],
  ['aims.project-create', '/v1/enterprise/aims/projects:create'],
  ['aims.project-edit', '/v1/enterprise/aims/projects:update'],
  ['aims.project-member-add', '/v1/enterprise/aims/project-members:add'],
  ['aims.project-member-role', '/v1/enterprise/aims/project-members:role'],
  ['aims.project-member-remove', '/v1/enterprise/aims/project-members:remove'],
  ['aims.work-item-create', '/v1/enterprise/aims/work-items:create'],
  ['aims.work-item-edit', '/v1/enterprise/aims/work-items:edit'],
  ['aims.work-item-delete', '/v1/enterprise/aims/work-items:delete'],
  ['aims.work-item-confirm-distribute', '/v1/enterprise/aims/work-items:confirm-distribute'],
  ['aims.work-item-revoke-distribute', '/v1/enterprise/aims/work-items:revoke-distribute'],
  ['aims.work-item-confirm-append', '/v1/enterprise/aims/work-items:confirm-append'],
  ['aims.work-item-reject-append', '/v1/enterprise/aims/work-items:reject-append'],
  ['aims.work-item-append-tasks', '/v1/enterprise/aims/work-items:append-tasks'],
  ['aims.work-item-breakdown', '/v1/enterprise/aims/work-items:breakdown'],
  ['aims.work-item-breakdown-context', '/v1/enterprise/aims/work-items:breakdown-context'],
  ['aims.work-item-associate', '/v1/enterprise/aims/work-items:associate'],
  ['aims.work-item-complete', '/v1/enterprise/aims/work-items:complete'],
  ['aims.work-item-matter-complete', '/v1/enterprise/aims/work-items:matter-complete'],
  ['aims.work-item-completion-replay', '/v1/enterprise/aims/work-items:completion-replay'],
  ['aims.work-item-list', '/v1/enterprise/aims/work-items:list'],
  ['aims.work-item-view', '/v1/enterprise/aims/work-items:view'],
  ['aims.time-entry-list', '/v1/enterprise/aims/time-entries:list'],
  ['aims.time-entry-view', '/v1/enterprise/aims/time-entries:view'],
  ['aims.weekly-report-list', '/v1/enterprise/aims/weekly-reports:list'],
  ['aims.weekly-report-view', '/v1/enterprise/aims/weekly-reports:view'],
  ['aims.project-member-list', '/v1/enterprise/aims/project-members:list'],
  ['aims.project-requirement-list', '/v1/enterprise/aims/project-requirements:list'],
  ['aims.project-requirement-view', '/v1/enterprise/aims/project-requirements:view'],
  ['aims.project-plan-milestones', '/v1/enterprise/aims/project-plan:milestones'],
  ['aims.project-plan-items', '/v1/enterprise/aims/project-plan:items'],
  ['aims.project-board-view', '/v1/enterprise/aims/project-board:view'],
  ['aims.timesheet-overview', '/v1/enterprise/aims/timesheet-overview:view'],
  ['aims.weekly-report-overview', '/v1/enterprise/aims/weekly-report-overview:view'],
  ['aims.project-document-accessible-list', '/v1/enterprise/aims/project-documents:accessible'],
  ['assets.product-directory', '/v1/enterprise/assets/product-directory'],
  ['aims.product-request-list', '/v1/enterprise/aims/product-requests:list'],
  ['aims.product-request-view', '/v1/enterprise/aims/product-requests:view'],
  ['aims.product-document-list', '/v1/enterprise/aims/product-documents:list'],
  ['aims.product-document-requests', '/v1/enterprise/aims/product-documents:requests'],
  ['aims.product-document-search', '/v1/enterprise/aims/product-documents:search'],
  ['aims.product-document-content', '/v1/enterprise/aims/product-documents:content'],
  ['aims.product-authorization', '/v1/enterprise/aims/product-authorization'],
  ['aims.work-item-comment-list', '/v1/enterprise/aims/work-item-comments:view'],
  ['aims.work-item-comment-create', '/v1/enterprise/aims/work-item-comments:create'],
  ['aims.work-item-commit-list', '/v1/enterprise/aims/work-item-commits:view'],
  ['aims.work-item-commit-link', '/v1/enterprise/aims/work-item-commits:link'],
  ['aims.work-item-commit-unlink', '/v1/enterprise/aims/work-item-commits:unlink'],
  ['aims.work-item-document-list', '/v1/enterprise/aims/work-item-documents:view'],
  ['aims.work-item-document-link', '/v1/enterprise/aims/work-item-documents:link'],
  ['aims.work-item-document-unlink', '/v1/enterprise/aims/work-item-documents:unlink'],
  ['aims.work-item-document-unlink-current', '/v1/enterprise/aims/work-item-documents:unlink-current'],
  ['aims.work-item-time-entry-list', '/v1/enterprise/aims/work-item-time-entries:view'],
  ['aims.work-item-time-entry-create', '/v1/enterprise/aims/work-item-time-entries:create'],
  ['aims.work-item-time-entry-update', '/v1/enterprise/aims/work-item-time-entries:update'],
  ['aims.work-item-time-entry-delete', '/v1/enterprise/aims/work-item-time-entries:delete'],
  ['aims.work-item-transitions', '/v1/enterprise/aims/work-item-execution:transitions'],
  ['aims.work-item-execution-context', '/v1/enterprise/aims/work-item-execution:context'],
  ['aims.work-item-source-sections', '/v1/enterprise/aims/work-item-execution:source-sections'],
  ['aims.work-item-decompose-context', '/v1/enterprise/aims/work-item-execution:decompose-context'],
  ['aims.work-item-children', '/v1/enterprise/aims/work-item-execution:children'],
  ['aims.work-item-decompose-submit', '/v1/enterprise/aims/work-item-decomposition:submit'],
  ['aims.work-item-clone-from-template', '/v1/enterprise/aims/work-item-decomposition:clone-from-template'],
  ['aims.work-item-deliverable-update', '/v1/enterprise/aims/work-item-deliverables:update'],
  ['aims.work-item-batch-update', '/v1/enterprise/aims/work-item-batch:update'],
  ['aims.project-favorite-list', '/v1/enterprise/aims/project-favorites:view'],
  ['aims.project-favorite-add', '/v1/enterprise/aims/project-favorites:add'],
  ['aims.project-favorite-remove', '/v1/enterprise/aims/project-favorites:remove'],
  ['aims.project-repo-list', '/v1/enterprise/aims/project-repos:view'],
  ['aims.project-repo-link', '/v1/enterprise/aims/project-repos:link'],
  ['aims.project-repo-unlink', '/v1/enterprise/aims/project-repos:unlink'],
  ['aims.project-work-item-list', '/v1/enterprise/aims/project-work-items:list'],
  ['aims.project-deliverable-list', '/v1/enterprise/aims/project-deliverables:list'],
  ['aims.project-deliverable-update', '/v1/enterprise/aims/project-deliverables:update'],
  ['aims.project-deliverable-delete', '/v1/enterprise/aims/project-deliverables:delete'],
  ['aims.project-deliverable-batch-create', '/v1/enterprise/aims/project-deliverables:batch-create'],
  ['aims.project-release-list', '/v1/enterprise/aims/project-releases:list'],
  ['aims.project-milestone-list', '/v1/enterprise/aims/project-milestones:list'],
  ['aims.project-milestone-create', '/v1/enterprise/aims/project-milestones:create'],
  ['aims.project-milestone-update', '/v1/enterprise/aims/project-milestones:update'],
  ['aims.project-milestone-delete', '/v1/enterprise/aims/project-milestones:delete'],
  ['aims.project-routine-review', '/v1/enterprise/aims/project-routine-review:view'],
  ['aims.project-portfolio-list', '/v1/enterprise/aims/project-portfolios:list'],
  ['aims.project-portfolio-create', '/v1/enterprise/aims/project-portfolios:create'],
  ['aims.project-portfolio-update', '/v1/enterprise/aims/project-portfolios:update'],
  ['aims.project-portfolio-delete', '/v1/enterprise/aims/project-portfolios:delete'],
  ['aims.project-delete', '/v1/enterprise/aims/project-deletion:execute'],
  ['aims.my-work-item-list', '/v1/enterprise/aims/my-work-items:list'],
  ['aims.time-entry-review-list', '/v1/enterprise/aims/time-entry-reviews:list'],
  ['aims.time-entry-review-submit', '/v1/enterprise/aims/time-entry-reviews:submit'],
  ['aims.user-time-entry-list', '/v1/enterprise/aims/user-time-entries:list'],
  ['aims.project-time-entry-create', '/v1/enterprise/aims/project-time-entries:create'],
  ['aims.project-time-entry-update', '/v1/enterprise/aims/project-time-entries:update'],
  ['aims.project-time-entry-delete', '/v1/enterprise/aims/project-time-entries:delete'],
  ['aims.timesheet-week-submit', '/v1/enterprise/aims/timesheet-weeks:submit'],
  ['aims.company-weekly-summary-view', '/v1/enterprise/aims/company-weekly-summaries:view'],
  ['aims.company-weekly-summary-versions', '/v1/enterprise/aims/company-weekly-summaries:versions'],
  ['aims.company-weekly-summary-save-draft', '/v1/enterprise/aims/company-weekly-summaries:save-draft'],
  ['aims.company-weekly-summary-generate', '/v1/enterprise/aims/company-weekly-summaries:generate'],
  ['aims.company-weekly-summary-publish', '/v1/enterprise/aims/company-weekly-summaries:publish'],
  ['aims.company-weekly-summary-cancel-publish', '/v1/enterprise/aims/company-weekly-summaries:cancel-publish'],
  ['aims.company-weekly-summary-open-correction', '/v1/enterprise/aims/company-weekly-summaries:open-correction'],
  ['aims.company-weekly-summary-retry', '/v1/enterprise/aims/company-weekly-summaries:retry'],
  ['aims.weekly-reporting-period-workbench', '/v1/enterprise/aims/weekly-reporting-periods:director-workbench'],
  ['aims.weekly-reporting-period-generate', '/v1/enterprise/aims/weekly-reporting-periods:generate'],
  ['aims.weekly-reporting-settings-view', '/v1/enterprise/aims/weekly-reporting-settings:view'],
  ['aims.weekly-reporting-settings-update', '/v1/enterprise/aims/weekly-reporting-settings:update'],
  ['aims.weekly-report-review', '/v1/enterprise/aims/weekly-report-review:review'],
  ['aims.weekly-report-open-correction', '/v1/enterprise/aims/weekly-report-review:open-correction'],
  ['aims.project-template-version-list', '/v1/enterprise/aims/project-template-versions:list'],
  ['aims.project-template-version-view', '/v1/enterprise/aims/project-template-versions:view'],
  ['aims.milestone-rollover', '/v1/enterprise/aims/milestone-rollover:execute'],
  ['aims.requirement-target-create', '/v1/enterprise/aims/requirement-targets:create'],
  ['aims.project-gitlab-commits', '/v1/enterprise/aims/project-gitlab:commits'],
  ['aims.project-gitlab-sync-context', '/v1/enterprise/aims/project-gitlab:sync-context'],
  ['aims.project-gitlab-commit-ingest', '/v1/enterprise/aims/project-gitlab:commit-ingest'],
  ['aims.work-item-commit-diff-metadata', '/v1/enterprise/aims/work-item-commit-diff:metadata'],
  ['aims.work-item-commit-files-changed', '/v1/enterprise/aims/work-item-commit-diff:files-changed'],
  ['aims.project-weekly-report-save-draft', '/v1/enterprise/aims/project-weekly-report-period:save-draft'],
  ['aims.project-weekly-report-submit', '/v1/enterprise/aims/project-weekly-report-period:submit'],
  ['aims.product-request-create', '/v1/enterprise/aims/product-requests:create', 'aims:product-requests:create']
] as const) {
  test(`enterprise ${operation} derives domain capability while retaining identity, actor and idempotency`, async () => {
    let requested = false
    const token = [Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ tenant: 'tenant-a', deployment: 'enterprise-test' })).toString('base64url'), 'test-signature'].join('.')
    const server = createServer(async (request, response) => {
      try {
        assert.equal(request.method, 'POST')
        assert.equal(request.url, path)
        assert.equal(request.headers['idempotency-key'], (['altoc.contracts-activate-delivery', 'assets.products-create', 'assets.products-edit', 'assets.product-categories-save', 'aims.handoff-create', 'aims.feature-create', 'aims.feature-edit', 'aims.feature-delete', 'aims.feature-component-assign', 'aims.feature-lifecycle', 'aims.feature-request-link', 'aims.time-entry-review-submit', 'aims.product-request-create', 'aims.product-onboard', 'aims.product-line-onboard', 'aims.component-create', 'aims.component-edit', 'aims.component-move', 'aims.component-delete'].includes(operation) || (operation.startsWith('aims.request-') && operation !== 'aims.request-source-list') || (operation.startsWith('aims.version-') && !['aims.version-execution-coordination', 'aims.version-scope-list', 'aims.version-scope-history', 'aims.version-acceptance-list', 'aims.version-acceptance-view', 'aims.version-release-list', 'aims.version-release-view', 'aims.version-list', 'aims.version-view', 'aims.version-plan', 'aims.version-plan-items'].includes(operation))) ? 'request-create-1' : undefined)
        assert.equal(request.headers.authorization, `Bearer ${token}`)
        assert.equal(request.headers['x-hzy-actor-uid'], 'person-a')
        assert.equal(request.headers['x-hzy-tenant'], 'tenant-a')
        assert.equal(request.headers['x-hzy-deployment'], 'enterprise-test')
        assert.equal(request.headers['x-hzy-app-code'], undefined)
        const canonical = ['POST', request.url, 'person-a', '', request.headers['x-hzy-actor-signed-at']].join('\n')
        assert.equal(request.headers['x-hzy-actor-signature'], createHmac('sha256', token).update(canonical).digest('base64url'))
        if (operation === 'aims.time-entry-review-submit') {
          let raw = ''
          for await (const chunk of request) raw += chunk
          const body = JSON.parse(raw)
          assert.equal(request.headers['x-hzy-enterprise-timesheet-review-write-signature'], createHmac('sha256', token).update(enterpriseTimesheetReviewWriteCanonical('POST', request.url!, 'person-a', 'tenant-a', 'enterprise-test', '12', body.payload, 'request-create-1')).digest('base64url'))
        }
        if (operation === 'aims.time-entry-review-list' || operation === 'aims.project-document-accessible-list' || /^altoc\.(?:customer|contract|receivable|lead|opportunity|quotation)-(?:list|view)$/.test(operation)) {
          let raw = ''
          for await (const chunk of request) raw += chunk
          const permit = JSON.parse(raw).authorization
          if (operation === 'aims.time-entry-review-list') assert.equal(request.headers['x-hzy-enterprise-timesheet-review-permit-signature'], createHmac('sha256', token).update(enterpriseTimesheetReviewPermitCanonical('POST', request.url!, permit)).digest('base64url'))
          else if (operation.startsWith('altoc.')) assert.equal(request.headers['x-hzy-enterprise-altoc-permit-signature'], createHmac('sha256', token).update(enterpriseAltocReadPermitCanonical('POST', request.url!, permit)).digest('base64url'))
          else assert.equal(request.headers['x-hzy-enterprise-document-permit-signature'], createHmac('sha256', token).update(enterpriseDocumentPermitCanonical('POST', request.url!, permit)).digest('base64url'))
        }
        requested = true
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ code: 0, data: { items: [] } }))
      } catch {
        response.statusCode = 500
        response.end('{}')
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      assert.ok(address && typeof address === 'object')
      globals.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' }, hzy: { tenantRuntime: { endpoint: `http://127.0.0.1:${address.port}`, dataAccessMode: 'tenant-runtime', token: 'legacy-static-token' } } })
      setLocalServiceTokenIssuer(async (input) => {
        assert.equal(input.scope, enterpriseHostDomainCapabilityForPath(path))
        assert.equal(input.sourceBinding, 'service-client-policy')
        return token
      })
      assert.deepEqual(await callEnterpriseRuntime(eventFor(), operation, operation === 'aims.time-entry-review-submit' ? { projectId: '12', payload: { action: 'approve', entries: [{ id: 7, rowVersion: 2 }], reason: '' } } : operation === 'aims.time-entry-review-list' ? { authorization: { ...JSON.parse(readFileSync(new URL('./fixtures/enterprise-time-entry-review-permit.json', import.meta.url), 'utf8')).authorization, expiresAt: enterpriseRuntimePermitExpiresAt() } } : operation.startsWith('altoc.') && operation !== 'altoc.contracts-activate-delivery' ? { id: operation.endsWith('-view') ? '7' : '', query: { page: 1, pageSize: 20, search: '', status: '', customerId: '', ...(/altoc\.(?:lead|opportunity|quotation)-/.test(operation) ? { opportunityId: '' } : { contractId: '' }) }, authorization: { actorUid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test', resource: operation.split('.')[1]!.split('-')[0], action: 'view', operation: operation.endsWith('-view') ? 'view' : 'list', objectId: operation.endsWith('-view') ? '7' : '', allowed: true, expiresAt: enterpriseRuntimePermitExpiresAt(), scope: { access: 'self', departmentCodes: [] }, bundleVersion: 'v1', bundleHash: 'hash', policyRevision: 42, query: { page: 1, pageSize: 20, search: '', status: '', customerId: '', ...(/altoc\.(?:lead|opportunity|quotation)-/.test(operation) ? { opportunityId: '' } : { contractId: '' }) } } } : operation === 'aims.project-document-accessible-list' ? { projectId: '257', authorization: { actorUid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test', resource: 'projects', action: 'view', projectId: '257', allowed: true, expiresAt: enterpriseRuntimePermitExpiresAt(), projectAdmin: true } } : { query: { page: 1 } }, (['altoc.contracts-activate-delivery', 'assets.products-create', 'assets.products-edit', 'assets.product-categories-save', 'aims.handoff-create', 'aims.feature-create', 'aims.feature-edit', 'aims.feature-delete', 'aims.feature-component-assign', 'aims.feature-lifecycle', 'aims.feature-request-link', 'aims.time-entry-review-submit', 'aims.product-request-create', 'aims.product-onboard', 'aims.product-line-onboard', 'aims.component-create', 'aims.component-edit', 'aims.component-move', 'aims.component-delete'].includes(operation) || (operation.startsWith('aims.request-') && operation !== 'aims.request-source-list') || (operation.startsWith('aims.version-') && !['aims.version-execution-coordination', 'aims.version-scope-list', 'aims.version-scope-history', 'aims.version-acceptance-list', 'aims.version-acceptance-view', 'aims.version-release-list', 'aims.version-release-view', 'aims.version-list', 'aims.version-view', 'aims.version-plan', 'aims.version-plan-items'].includes(operation))) ? { idempotencyKey: 'request-create-1' } : {}), { code: 0, data: { items: [] } })
      assert.equal(requested, true)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })
}

test('service identities and incomplete user bindings cannot enter user business operations', async () => {
  globals.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  for (const override of [{ subjectType: 'service' }, { tokenUse: 'service' }, { uid: '' }, { tenant: '' }, { deployment: '' }]) {
    await assert.rejects(requireEnterpriseUser(eventFor({ ...user, ...override })), { statusCode: 401 })
  }
  globals.useRuntimeConfig = () => ({ public: { appCode: 'aims' } })
  await assert.rejects(requireEnterpriseUser(eventFor()), { statusCode: 503 })
})

test('prepares the exact enterprise operation credential before a permit is created', async () => {
  globals.useRuntimeConfig = () => ({
    public: { appCode: 'enterprise' },
    hzy: { tenantRuntime: { endpoint: 'https://runtime.example.test', dataAccessMode: 'tenant-runtime' } }
  })
  let issued: { audience: string, scope: string, sourceBinding?: string } | undefined
  setLocalServiceTokenIssuer(async (input) => {
    issued = input
    return 'prepared-service-token'
  })

  await prepareEnterpriseRuntime(eventFor(), 'assets.product-dictionaries')
  assert.equal(issued?.audience, 'data-runtime')
  assert.equal(issued?.scope, 'assets:enterprise-host:execute')
  assert.equal(issued?.sourceBinding, 'service-client-policy')
})

test('enterprise permits keep a one-second margin inside the Runtime future bound', () => {
  const runtimeNow = 1_000_000
  const hostNow = runtimeNow + 500
  const permitExpiresAt = enterpriseRuntimePermitExpiresAt(hostNow)

  assert.ok(hostNow + 15_000 > runtimeNow + 15_000, 'the former exact 15-second permit would be future-bound')
  assert.ok(permitExpiresAt > runtimeNow, 'the shorter permit remains fresh')
  assert.ok(permitExpiresAt <= runtimeNow + 15_000, 'the shorter permit stays inside the Runtime maximum')
})

test('caps only legal explicit Host permits without renewing invalid values or changing request input', () => {
  const now = 1_000_000
  const body = {
    input: { expiresAt: now + 15_000 },
    authorization: { expires_at: now + 15_000, facts: { expiresAt: now + 15_000 } },
    assets_authorization: { expiresAt: now - 1 },
    documentAuthorization: { expiresAt: now + 15_001 },
    predecessor_authorizations: [{ expires_at: now + 15_000 }]
  }
  const capped = capEnterpriseRuntimePermitExpiries(body, now) as typeof body

  assert.equal(capped.input.expiresAt, now + 15_000)
  assert.equal(capped.authorization.expires_at, now + 14_000)
  assert.equal(capped.authorization.facts.expiresAt, now + 15_000)
  assert.equal(capped.assets_authorization.expiresAt, now - 1)
  assert.equal(capped.documentAuthorization.expiresAt, now + 15_001)
  assert.equal(capped.predecessor_authorizations[0].expires_at, now + 14_000)
  assert.equal(body.authorization.expires_at, now + 15_000)
})

test('Host permits use trusted Host deployment without rewriting the Console user session', async () => {
  globals.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' }, hzy: { tenantGateway: { internalToken: 'test-gateway-secret' } } })
  const session = { ...user, deployment: 'console-test' }
  const request = {
    context: { consoleAuth: session },
    node: { req: { headers: {
      'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': 'test-gateway-secret',
      'x-hzy-tenant': 'tenant-a', 'x-hzy-deployment': 'enterprise-test', 'x-hzy-app-code': 'enterprise'
    } } }
  }
  assert.equal((await requireEnterpriseUser(request as never)).deployment, 'enterprise-test')
  assert.equal(request.context.consoleAuth.deployment, 'console-test')
  request.node.req.headers['x-hzy-tenant'] = 'tenant-b'
  await assert.rejects(requireEnterpriseUser(request as never), { statusCode: 403 })
  request.node.req.headers['x-hzy-tenant'] = 'tenant-a'
  request.node.req.headers['x-hzy-app-code'] = 'aims'
  await assert.rejects(requireEnterpriseUser(request as never), { statusCode: 403 })
  request.node.req.headers['x-hzy-gateway-token'] = 'forged'
  assert.equal((await requireEnterpriseUser(request as never)).deployment, 'console-test')
})

test('Altoc permit canonical matches the Runtime shared vector including Unicode and punctuation', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/enterprise-altoc-read-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAltocReadPermitCanonical(fixture.method, fixture.target, fixture.authorization), fixture.canonical)
  assert.equal(createHmac('sha256', fixture.token).update(fixture.canonical).digest('base64url'), fixture.signature)
  for (const key of Object.keys(fixture.authorization)) {
    assert.notEqual(enterpriseAltocReadPermitCanonical(fixture.method, fixture.target, { ...fixture.authorization, [key]: key === 'scope' ? { access: 'all', departmentCodes: [] } : key === 'query' ? { ...fixture.authorization.query, page: 3 } : 'tampered' }), fixture.canonical)
  }
})

test('G2 permit canonical matches Runtime vector and signs opportunityId independently', () => {
  const f = JSON.parse(readFileSync(new URL('../../data-runtime/internal/server/testdata/enterprise-altoc-sales-read-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAltocReadPermitCanonical(f.method, f.target, f.authorization), f.canonical)
  assert.equal(createHmac('sha256', f.token).update(f.canonical).digest('base64url'), f.signature)
  for (const key of Object.keys(f.authorization.query)) assert.notEqual(enterpriseAltocReadPermitCanonical(f.method, f.target, { ...f.authorization, query: { ...f.authorization.query, [key]: 'tampered' } }), f.canonical)
})

test('timesheet review independent permit covers every authorization branch and current query', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/enterprise-time-entry-review-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseTimesheetReviewPermitCanonical(fixture.method, fixture.target, fixture.authorization), fixture.canonical)
  assert.equal(createHmac('sha256', fixture.token).update(fixture.canonical).digest('base64url'), fixture.signature)
  for (const key of Object.keys(fixture.authorization)) {
    const permit = structuredClone(fixture.authorization)
    if (key === 'branches') permit.branches[0].scope.masks[0] = 65535
    else if (key === 'query') permit.query.periodKey = '2026-W40'
    else permit[key] = 'tampered'
    assert.notEqual(enterpriseTimesheetReviewPermitCanonical(fixture.method, fixture.target, permit), fixture.canonical)
  }
})
