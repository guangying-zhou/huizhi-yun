import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { callEnterpriseRuntime, capEnterpriseRuntimePermitExpiries, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '../server/utils/enterpriseRuntimeClient.ts'
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

for (const [operation, path, capability] of [
  ['altoc.contracts-activate-delivery', '/v1/enterprise/altoc/contracts:activate-delivery', 'altoc:contract:activate-delivery'],
  ['assets.products-link-base', '/v1/enterprise/assets/products:link-base', 'assets:product:edit'],
  ['assets.products-link-asset', '/v1/enterprise/assets/products:link-asset', 'assets:product:edit'],
  ['assets.products-link-document', '/v1/enterprise/assets/products:link-document', 'assets:product:edit'],
  ['assets.products-base-candidates', '/v1/enterprise/assets/products:base-candidates', 'assets:product:read'],
  ['assets.products-asset-candidates', '/v1/enterprise/assets/products:asset-candidates', 'assets:product:read'],
  ['assets.products-list', '/v1/enterprise/assets/products:list', 'assets:product:read'],
  ['assets.products-view', '/v1/enterprise/assets/products:view', 'assets:product:read'],
  ['assets.product-dictionaries', '/v1/enterprise/assets/product-dictionaries:list', 'assets:product:read'],
  ['assets.product-categories', '/v1/enterprise/assets/product-categories:list', 'assets:product:read'],
  ['assets.asset-dictionaries', '/v1/enterprise/assets/dictionaries:list', 'assets:asset-item:read'],
  ['assets.asset-items-list', '/v1/enterprise/assets/assets:list', 'assets:asset-item:read'],
  ['assets.asset-items-view', '/v1/enterprise/assets/assets:view', 'assets:asset-item:read'],
  ['assets.digital-assets-list', '/v1/enterprise/assets/digital-assets:list', 'assets:digital-asset:read'],
  ['assets.digital-assets-view', '/v1/enterprise/assets/digital-assets:view', 'assets:digital-asset:read'],
  ['assets.ip-assets-list', '/v1/enterprise/assets/ip-assets:list', 'assets:ip-asset:read'],
  ['assets.ip-assets-view', '/v1/enterprise/assets/ip-assets:view', 'assets:ip-asset:read'],
  ['assets.ip-assets-create', '/v1/enterprise/assets/ip-assets:create', 'assets:ip-asset:create'],
  ['assets.ip-assets-edit', '/v1/enterprise/assets/ip-assets:edit', 'assets:ip-asset:edit'],
	['assets.digital-assets-create', '/v1/enterprise/assets/digital-assets:create', 'assets:digital-asset:create'],
	['assets.digital-assets-edit', '/v1/enterprise/assets/digital-assets:edit', 'assets:digital-asset:edit'],
  ['assets.products-create', '/v1/enterprise/assets/products:create', 'assets:product:edit'],
  ['assets.products-edit', '/v1/enterprise/assets/products:edit', 'assets:product:edit'],
  ['assets.product-categories-admin', '/v1/enterprise/assets/product-categories:admin-list', 'assets:admin:admin'],
  ['assets.product-categories-save', '/v1/enterprise/assets/product-categories:save', 'assets:admin:admin'],

  ['aims.handoff-detail', '/v1/enterprise/aims/handoff:detail', 'aims:product-priorities:read'],
  ['aims.handoff-projects', '/v1/enterprise/aims/handoff:projects', 'aims:product-priorities:project-authorization'],
  ['aims.handoff-requirements', '/v1/enterprise/aims/handoff:requirements', 'aims:product-priorities:project-authorization'],
  ['aims.handoff-project-authorization', '/v1/enterprise/aims/handoff:project-authorization', 'aims:product-priorities:project-authorization'],
  ['aims.handoff-create', '/v1/enterprise/aims/handoff:create', 'aims:product-priorities:handoff'],
  ['aims.version-execution-coordination', '/v1/enterprise/aims/product-version:execution-coordination', 'aims:product-versions:read'],

  ['aims.version-acceptance-list', '/v1/enterprise/aims/product-version:acceptance-list', 'aims:product-versions:read'],
  ['aims.version-acceptance-view', '/v1/enterprise/aims/product-version:acceptance-view', 'aims:product-versions:read'],
  ['aims.version-release-list', '/v1/enterprise/aims/product-version:release-list', 'aims:product-versions:read'],
  ['aims.version-release-view', '/v1/enterprise/aims/product-version:release-view', 'aims:product-versions:read'],

  ['aims.feature-cycles', '/v1/enterprise/aims/features:cycles', 'aims:product-priorities:read'],
  ['aims.feature-list', '/v1/enterprise/aims/features:list', 'aims:product-features:read'],
  ['aims.feature-view', '/v1/enterprise/aims/features:view', 'aims:product-features:read'],
  ['aims.feature-create', '/v1/enterprise/aims/features:create', 'aims:product-features:create'],
  ['aims.feature-edit', '/v1/enterprise/aims/features:edit', 'aims:product-features:edit'],
  ['aims.feature-delete', '/v1/enterprise/aims/features:delete', 'aims:product-features:delete'],
  ['aims.feature-component-assign', '/v1/enterprise/aims/features:component-assign', 'aims:product-features:component-assign'],
  ['aims.feature-lifecycle', '/v1/enterprise/aims/features:lifecycle', 'aims:product-features:lifecycle'],
  ['aims.feature-request-list', '/v1/enterprise/aims/features:request-list', 'aims:product-features:read'],
  ['aims.feature-request-link', '/v1/enterprise/aims/features:request-link', 'aims:product-features:request-link'],
  ['aims.feature-roadmap', '/v1/enterprise/aims/features:roadmap', 'aims:product-priorities:read'],
  ['aims.feature-unscheduled', '/v1/enterprise/aims/features:unscheduled', 'aims:product-priorities:read'],

  ['aims.component-create', '/v1/enterprise/aims/components:create', 'aims:product-components:create'],
  ['aims.component-edit', '/v1/enterprise/aims/components:edit', 'aims:product-components:edit'],
  ['aims.component-move', '/v1/enterprise/aims/components:move', 'aims:product-components:move'],
  ['aims.component-delete', '/v1/enterprise/aims/components:delete', 'aims:product-components:delete'],
  ['aims.onboard-candidates', '/v1/enterprise/aims/product-onboard:candidates', 'aims:products:onboard'],
  ['aims.onboard-candidate', '/v1/enterprise/aims/product-onboard:candidate', 'aims:products:onboard'],
  ['aims.onboard-line-candidates', '/v1/enterprise/aims/product-line-onboard:candidates', 'aims:products:onboard'],
  ['aims.product-onboard', '/v1/enterprise/aims/product-onboard', 'aims:products:onboard'],
  ['aims.product-line-onboard', '/v1/enterprise/aims/product-line-onboard', 'aims:products:onboard'],
  ['aims.request-merge', '/v1/enterprise/aims/product-requests:merge', 'aims:product-requests:merge'],
  ['aims.request-edit', '/v1/enterprise/aims/product-requests:edit', 'aims:product-requests:edit'],
  ['aims.request-decide', '/v1/enterprise/aims/product-requests:decide', 'aims:product-requests:decide'],
  ['aims.request-source-list', '/v1/enterprise/aims/request-sources:list', 'aims:product-requests:read'],
  ['aims.request-source-create', '/v1/enterprise/aims/request-sources:create', 'aims:product-requests:source-create'],
  ['aims.request-source-delete', '/v1/enterprise/aims/request-sources:delete', 'aims:product-requests:source-delete'],
  ['aims.version-plan', '/v1/enterprise/aims/versions:plan', 'aims:product-versions:read'],
  ['aims.version-plan-items', '/v1/enterprise/aims/versions:plan-items', 'aims:product-versions:read'],
  ['aims.version-list', '/v1/enterprise/aims/versions:list', 'aims:product-versions:read'],
  ['aims.version-view', '/v1/enterprise/aims/versions:view', 'aims:product-versions:read'],
  ['aims.version-create', '/v1/enterprise/aims/versions:create', 'aims:product-versions:create'],
  ['aims.version-plan-edit', '/v1/enterprise/aims/versions:plan-edit', 'aims:product-versions:edit'],
  ['aims.version-plan-item-create', '/v1/enterprise/aims/versions:plan-item-create', 'aims:product-versions:edit'],
  ['aims.version-plan-item-edit', '/v1/enterprise/aims/versions:plan-item-edit', 'aims:product-versions:edit'],
  ['aims.version-plan-item-delete', '/v1/enterprise/aims/versions:plan-item-delete', 'aims:product-versions:edit'],
  ['aims.version-plan-confirm', '/v1/enterprise/aims/versions:plan-confirm', 'aims:product-versions:edit'],
  ['aims.product-list', '/v1/enterprise/aims/product-list', 'aims:products:view'],
  ['aims.component-list', '/v1/enterprise/aims/components:list', 'aims:product-components:read'],
  ['aims.product-workspace-view', '/v1/enterprise/aims/product-workspace:view', 'aims:products:view'],
  ['aims.project-list', '/v1/enterprise/aims/projects:list', 'aims:projects:view'],
  ['aims.project-view', '/v1/enterprise/aims/projects:view', 'aims:projects:view'],
  ['aims.project-create', '/v1/enterprise/aims/projects:create', 'aims:project-create:execute'],
  ['aims.project-edit', '/v1/enterprise/aims/projects:update', 'aims:project-edit:execute'],
  ['aims.project-member-add', '/v1/enterprise/aims/project-members:add', 'aims:project-member-add:execute'],
  ['aims.project-member-role', '/v1/enterprise/aims/project-members:role', 'aims:project-member-role:execute'],
  ['aims.project-member-remove', '/v1/enterprise/aims/project-members:remove', 'aims:project-member-remove:execute'],
  ['aims.work-item-create', '/v1/enterprise/aims/work-items:create', 'aims:work-item-create:execute'],
  ['aims.work-item-edit', '/v1/enterprise/aims/work-items:edit', 'aims:work-item-edit:execute'],
  ['aims.work-item-delete', '/v1/enterprise/aims/work-items:delete', 'aims:work-item-delete:execute'],
  ['aims.work-item-confirm-distribute', '/v1/enterprise/aims/work-items:confirm-distribute', 'aims:work-item-distribute-confirm:execute'],
  ['aims.work-item-revoke-distribute', '/v1/enterprise/aims/work-items:revoke-distribute', 'aims:work-item-distribute-revoke:execute'],
  ['aims.work-item-confirm-append', '/v1/enterprise/aims/work-items:confirm-append', 'aims:work-item-append-confirm:execute'],
  ['aims.work-item-reject-append', '/v1/enterprise/aims/work-items:reject-append', 'aims:work-item-append-reject:execute'],
  ['aims.work-item-append-tasks', '/v1/enterprise/aims/work-items:append-tasks', 'aims:work-item-append-tasks:execute'],
  ['aims.work-item-breakdown', '/v1/enterprise/aims/work-items:breakdown', 'aims:work-item-breakdown:execute'],
  ['aims.work-item-breakdown-context', '/v1/enterprise/aims/work-items:breakdown-context', 'aims:work-items:view'],
  ['aims.work-item-associate', '/v1/enterprise/aims/work-items:associate', 'aims:work-item-associate:execute'],
  ['aims.work-item-complete', '/v1/enterprise/aims/work-items:complete', 'aims:work-item-complete:execute'],
  ['aims.work-item-completion-replay', '/v1/enterprise/aims/work-items:completion-replay', 'aims:work-item-completion-replay:execute'],
  ['aims.work-item-list', '/v1/enterprise/aims/work-items:list', 'aims:work-items:view'],
  ['aims.work-item-view', '/v1/enterprise/aims/work-items:view', 'aims:work-items:view'],
  ['aims.time-entry-list', '/v1/enterprise/aims/time-entries:list', 'aims:time-entries:view'],
  ['aims.time-entry-view', '/v1/enterprise/aims/time-entries:view', 'aims:time-entries:view'],
  ['aims.weekly-report-list', '/v1/enterprise/aims/weekly-reports:list', 'aims:weekly-reports:view'],
  ['aims.weekly-report-view', '/v1/enterprise/aims/weekly-reports:view', 'aims:weekly-reports:view'],
  ['aims.project-member-list', '/v1/enterprise/aims/project-members:list', 'aims:project-members:view'],
  ['aims.project-requirement-list', '/v1/enterprise/aims/project-requirements:list', 'aims:requirements:view'],
  ['aims.project-requirement-view', '/v1/enterprise/aims/project-requirements:view', 'aims:requirements:view'],
  ['aims.project-plan-milestones', '/v1/enterprise/aims/project-plan:milestones', 'aims:project-plan:view'],
  ['aims.project-plan-items', '/v1/enterprise/aims/project-plan:items', 'aims:project-plan:view'],
  ['aims.project-board-view', '/v1/enterprise/aims/project-board:view', 'aims:project-board:view'],
  ['aims.timesheet-overview', '/v1/enterprise/aims/timesheet-overview:view', 'aims:timesheet-overview:view'],
  ['aims.weekly-report-overview', '/v1/enterprise/aims/weekly-report-overview:view', 'aims:weekly-report-overview:view'],
  ['assets.product-directory', '/v1/enterprise/assets/product-directory', 'assets:product:read'],
  ['aims.product-request-list', '/v1/enterprise/aims/product-requests:list', 'aims:product-requests:read'],
  ['aims.product-request-view', '/v1/enterprise/aims/product-requests:view', 'aims:product-requests:read'],
  ['aims.product-authorization', '/v1/enterprise/aims/product-authorization', 'aims:products:authorization-object'],
  ['aims.work-item-comment-list', '/v1/enterprise/aims/work-item-comments:view', 'aims:work-item-comments:view'],
  ['aims.work-item-comment-create', '/v1/enterprise/aims/work-item-comments:create', 'aims:work-item-comments:edit'],
  ['aims.work-item-commit-list', '/v1/enterprise/aims/work-item-commits:view', 'aims:work-item-commits:view'],
  ['aims.work-item-commit-link', '/v1/enterprise/aims/work-item-commits:link', 'aims:work-item-commits:edit'],
  ['aims.work-item-commit-unlink', '/v1/enterprise/aims/work-item-commits:unlink', 'aims:work-item-commits:edit'],
  ['aims.work-item-document-list', '/v1/enterprise/aims/work-item-documents:view', 'aims:work-item-documents:view'],
  ['aims.work-item-document-link', '/v1/enterprise/aims/work-item-documents:link', 'aims:work-item-documents:edit'],
  ['aims.work-item-document-unlink', '/v1/enterprise/aims/work-item-documents:unlink', 'aims:work-item-documents:edit'],
  ['aims.work-item-document-unlink-current', '/v1/enterprise/aims/work-item-documents:unlink-current', 'aims:work-item-documents:edit'],
  ['aims.work-item-time-entry-list', '/v1/enterprise/aims/work-item-time-entries:view', 'aims:work-item-time-entries:view'],
  ['aims.work-item-time-entry-create', '/v1/enterprise/aims/work-item-time-entries:create', 'aims:work-item-time-entries:edit'],
  ['aims.work-item-time-entry-update', '/v1/enterprise/aims/work-item-time-entries:update', 'aims:work-item-time-entries:edit'],
  ['aims.work-item-time-entry-delete', '/v1/enterprise/aims/work-item-time-entries:delete', 'aims:work-item-time-entries:edit'],
  ['aims.work-item-transitions', '/v1/enterprise/aims/work-item-execution:transitions', 'aims:work-item-execution:view'],
  ['aims.work-item-execution-context', '/v1/enterprise/aims/work-item-execution:context', 'aims:work-item-execution:view'],
  ['aims.work-item-source-sections', '/v1/enterprise/aims/work-item-execution:source-sections', 'aims:work-item-execution:view'],
  ['aims.work-item-decompose-context', '/v1/enterprise/aims/work-item-execution:decompose-context', 'aims:work-item-execution:view'],
  ['aims.work-item-children', '/v1/enterprise/aims/work-item-execution:children', 'aims:work-item-execution:view'],
  ['aims.work-item-decompose-submit', '/v1/enterprise/aims/work-item-decomposition:submit', 'aims:work-item-decomposition:edit'],
  ['aims.work-item-clone-from-template', '/v1/enterprise/aims/work-item-decomposition:clone-from-template', 'aims:work-item-decomposition:edit'],
  ['aims.work-item-deliverable-update', '/v1/enterprise/aims/work-item-deliverables:update', 'aims:work-item-deliverables:edit'],
  ['aims.work-item-batch-update', '/v1/enterprise/aims/work-item-batch:update', 'aims:work-item-batch:edit'],
  ['aims.project-favorite-list', '/v1/enterprise/aims/project-favorites:view', 'aims:project-favorites:view'],
  ['aims.project-favorite-add', '/v1/enterprise/aims/project-favorites:add', 'aims:project-favorites:edit'],
  ['aims.project-favorite-remove', '/v1/enterprise/aims/project-favorites:remove', 'aims:project-favorites:edit'],
  ['aims.project-repo-list', '/v1/enterprise/aims/project-repos:view', 'aims:project-repos:view'],
  ['aims.project-repo-link', '/v1/enterprise/aims/project-repos:link', 'aims:project-repos:edit'],
  ['aims.project-repo-unlink', '/v1/enterprise/aims/project-repos:unlink', 'aims:project-repos:edit'],
  ['aims.project-work-item-list', '/v1/enterprise/aims/project-work-items:list', 'aims:project-work-items:view'],
  ['aims.project-deliverable-list', '/v1/enterprise/aims/project-deliverables:list', 'aims:project-deliverables:view'],
  ['aims.project-deliverable-update', '/v1/enterprise/aims/project-deliverables:update', 'aims:project-deliverables:edit'],
  ['aims.project-deliverable-delete', '/v1/enterprise/aims/project-deliverables:delete', 'aims:project-deliverables:edit'],
  ['aims.project-deliverable-batch-create', '/v1/enterprise/aims/project-deliverables:batch-create', 'aims:project-deliverables:edit'],
  ['aims.project-release-list', '/v1/enterprise/aims/project-releases:list', 'aims:project-releases:view'],
  ['aims.project-milestone-list', '/v1/enterprise/aims/project-milestones:list', 'aims:project-milestones:view'],
  ['aims.project-milestone-create', '/v1/enterprise/aims/project-milestones:create', 'aims:project-milestones:edit'],
  ['aims.project-milestone-update', '/v1/enterprise/aims/project-milestones:update', 'aims:project-milestones:edit'],
  ['aims.project-milestone-delete', '/v1/enterprise/aims/project-milestones:delete', 'aims:project-milestones:edit'],
  ['aims.project-routine-review', '/v1/enterprise/aims/project-routine-review:view', 'aims:project-routine-review:view'],
  ['aims.project-portfolio-list', '/v1/enterprise/aims/project-portfolios:list', 'aims:project-portfolios:view'],
  ['aims.project-portfolio-create', '/v1/enterprise/aims/project-portfolios:create', 'aims:project-portfolios:edit'],
  ['aims.project-portfolio-update', '/v1/enterprise/aims/project-portfolios:update', 'aims:project-portfolios:edit'],
  ['aims.project-portfolio-delete', '/v1/enterprise/aims/project-portfolios:delete', 'aims:project-portfolios:edit'],
  ['aims.project-delete', '/v1/enterprise/aims/project-deletion:execute', 'aims:project-deletion:execute'],
  ['aims.my-work-item-list', '/v1/enterprise/aims/my-work-items:list', 'aims:my-work-items:view'],
  ['aims.time-entry-review-list', '/v1/enterprise/aims/time-entry-reviews:list', 'aims:time-entry-reviews:view'],
  ['aims.time-entry-review-submit', '/v1/enterprise/aims/time-entry-reviews:submit', 'aims:time-entry-reviews:edit'],
  ['aims.user-time-entry-list', '/v1/enterprise/aims/user-time-entries:list', 'aims:user-time-entries:view'],
  ['aims.project-time-entry-create', '/v1/enterprise/aims/project-time-entries:create', 'aims:project-time-entries:edit'],
  ['aims.project-time-entry-update', '/v1/enterprise/aims/project-time-entries:update', 'aims:project-time-entries:edit'],
  ['aims.project-time-entry-delete', '/v1/enterprise/aims/project-time-entries:delete', 'aims:project-time-entries:edit'],
  ['aims.timesheet-week-submit', '/v1/enterprise/aims/timesheet-weeks:submit', 'aims:timesheet-weeks:edit'],
  ['aims.company-weekly-summary-view', '/v1/enterprise/aims/company-weekly-summaries:view', 'aims:company-weekly-summaries:view'],
  ['aims.company-weekly-summary-versions', '/v1/enterprise/aims/company-weekly-summaries:versions', 'aims:company-weekly-summaries:view'],
  ['aims.company-weekly-summary-save-draft', '/v1/enterprise/aims/company-weekly-summaries:save-draft', 'aims:company-weekly-summaries:edit'],
  ['aims.company-weekly-summary-generate', '/v1/enterprise/aims/company-weekly-summaries:generate', 'aims:company-weekly-summaries:edit'],
  ['aims.company-weekly-summary-publish', '/v1/enterprise/aims/company-weekly-summaries:publish', 'aims:company-weekly-summaries:edit'],
  ['aims.company-weekly-summary-cancel-publish', '/v1/enterprise/aims/company-weekly-summaries:cancel-publish', 'aims:company-weekly-summaries:edit'],
  ['aims.company-weekly-summary-open-correction', '/v1/enterprise/aims/company-weekly-summaries:open-correction', 'aims:company-weekly-summaries:edit'],
  ['aims.company-weekly-summary-retry', '/v1/enterprise/aims/company-weekly-summaries:retry', 'aims:company-weekly-summaries:edit'],
  ['aims.weekly-reporting-period-workbench', '/v1/enterprise/aims/weekly-reporting-periods:director-workbench', 'aims:weekly-reporting-periods:view'],
  ['aims.weekly-reporting-period-generate', '/v1/enterprise/aims/weekly-reporting-periods:generate', 'aims:weekly-reporting-periods:edit'],
  ['aims.weekly-report-review', '/v1/enterprise/aims/weekly-report-review:review', 'aims:weekly-report-review:edit'],
  ['aims.weekly-report-open-correction', '/v1/enterprise/aims/weekly-report-review:open-correction', 'aims:weekly-report-review:edit'],
  ['aims.project-template-version-list', '/v1/enterprise/aims/project-template-versions:list', 'aims:project-template-versions:view'],
  ['aims.project-template-version-view', '/v1/enterprise/aims/project-template-versions:view', 'aims:project-template-versions:view'],
  ['aims.milestone-rollover', '/v1/enterprise/aims/milestone-rollover:execute', 'aims:milestone-rollover:execute'],
  ['aims.requirement-target-create', '/v1/enterprise/aims/requirement-targets:create', 'aims:requirement-targets:edit'],
  ['aims.project-gitlab-commits', '/v1/enterprise/aims/project-gitlab:commits', 'aims:project-gitlab:view'],
  ['aims.project-gitlab-sync-context', '/v1/enterprise/aims/project-gitlab:sync-context', 'aims:project-gitlab:view'],
  ['aims.project-gitlab-commit-ingest', '/v1/enterprise/aims/project-gitlab:commit-ingest', 'aims:project-gitlab:edit'],
  ['aims.work-item-commit-diff-metadata', '/v1/enterprise/aims/work-item-commit-diff:metadata', 'aims:work-item-commit-diff:view'],
  ['aims.work-item-commit-files-changed', '/v1/enterprise/aims/work-item-commit-diff:files-changed', 'aims:work-item-commit-diff:edit'],
  ['aims.project-weekly-report-save-draft', '/v1/enterprise/aims/project-weekly-report-period:save-draft', 'aims:project-weekly-report-period:edit'],
  ['aims.project-weekly-report-submit', '/v1/enterprise/aims/project-weekly-report-period:submit', 'aims:project-weekly-report-period:edit'],
  ['aims.product-request-create', '/v1/enterprise/aims/product-requests:create', 'aims:product-requests:create']
] as const) {
  test(`enterprise ${operation} retains exact capability, identity, actor and idempotency`, async () => {
    let requested = false
    const token = [Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ tenant: 'tenant-a', deployment: 'enterprise-test' })).toString('base64url'), 'test-signature'].join('.')
    const server = createServer(async (request, response) => {
      try {
        assert.equal(request.method, 'POST')
        assert.equal(request.url, path)
        assert.equal(request.headers['idempotency-key'], (['altoc.contracts-activate-delivery', 'assets.products-create', 'assets.products-edit', 'assets.product-categories-save', 'aims.handoff-create', 'aims.feature-create', 'aims.feature-edit', 'aims.feature-delete', 'aims.feature-component-assign', 'aims.feature-lifecycle', 'aims.feature-request-link', 'aims.product-request-create', 'aims.product-onboard', 'aims.product-line-onboard', 'aims.component-create', 'aims.component-edit', 'aims.component-move', 'aims.component-delete'].includes(operation) || (operation.startsWith('aims.request-') && operation !== 'aims.request-source-list') || (operation.startsWith('aims.version-') && !['aims.version-execution-coordination', 'aims.version-acceptance-list','aims.version-acceptance-view','aims.version-release-list','aims.version-release-view', 'aims.version-list', 'aims.version-view', 'aims.version-plan', 'aims.version-plan-items'].includes(operation))) ? 'request-create-1' : undefined)
        assert.equal(request.headers.authorization, `Bearer ${token}`)
        assert.equal(request.headers['x-hzy-actor-uid'], 'person-a')
        assert.equal(request.headers['x-hzy-tenant'], 'tenant-a')
        assert.equal(request.headers['x-hzy-deployment'], 'enterprise-test')
        assert.equal(request.headers['x-hzy-app-code'], undefined)
        const canonical = ['POST', request.url, 'person-a', '', request.headers['x-hzy-actor-signed-at']].join('\n')
        assert.equal(request.headers['x-hzy-actor-signature'], createHmac('sha256', token).update(canonical).digest('base64url'))
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
        assert.equal(input.scope, capability)
        assert.equal(input.sourceBinding, 'service-client-policy')
        return token
      })
      assert.deepEqual(await callEnterpriseRuntime(eventFor(), operation, { query: { page: 1 } }, (['altoc.contracts-activate-delivery', 'assets.products-create', 'assets.products-edit', 'assets.product-categories-save', 'aims.handoff-create', 'aims.feature-create', 'aims.feature-edit', 'aims.feature-delete', 'aims.feature-component-assign', 'aims.feature-lifecycle', 'aims.feature-request-link', 'aims.product-request-create', 'aims.product-onboard', 'aims.product-line-onboard', 'aims.component-create', 'aims.component-edit', 'aims.component-move', 'aims.component-delete'].includes(operation) || (operation.startsWith('aims.request-') && operation !== 'aims.request-source-list') || (operation.startsWith('aims.version-') && !['aims.version-execution-coordination', 'aims.version-acceptance-list','aims.version-acceptance-view','aims.version-release-list','aims.version-release-view', 'aims.version-list', 'aims.version-view', 'aims.version-plan', 'aims.version-plan-items'].includes(operation))) ? { idempotencyKey: 'request-create-1' } : {}), { code: 0, data: { items: [] } })
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
  setLocalServiceTokenIssuer(async input => {
    issued = input
    return 'prepared-service-token'
  })

  await prepareEnterpriseRuntime(eventFor(), 'assets.product-dictionaries')
  assert.equal(issued?.audience, 'data-runtime')
  assert.equal(issued?.scope, 'assets:product:read')
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
