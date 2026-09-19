import { createError, type H3Event } from 'h3'
import { resolveConsoleAuthWithSessionBridge } from './consoleSessionBridge'
import * as tenantRuntimeClient from './tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from './tenantGatewayTrust'

const enterpriseRuntimePermitTtlMs = 14_000

// Business handlers select a registered operation in server code. Neither a
// browser path parameter nor forwarded app headers choose a runtime identity.
const operations = {
  'codocs.personal-cabinet-list': { path: '/v1/enterprise/codocs/personal-cabinet:list', capability: 'codocs:personal-cabinet:read' },
  'codocs.personal-cabinet-view': { path: '/v1/enterprise/codocs/personal-cabinet:view', capability: 'codocs:personal-cabinet:read' },
  'codocs.personal-cabinet-download': { path: '/v1/enterprise/codocs/personal-cabinet:download', capability: 'codocs:personal-cabinet:export' },
  'codocs.personal-cabinet-converted-info': { path: '/v1/enterprise/codocs/personal-cabinet:converted-info', capability: 'codocs:personal-cabinet:read' },
  'codocs.personal-document-recycle': { path: '/v1/enterprise/codocs/personal-documents:recycle', capability: 'codocs:personal-documents:delete' },
  'codocs.personal-document-restore-plan': { path: '/v1/enterprise/codocs/personal-documents:restore-plan', capability: 'codocs:personal-documents:edit' },
  'codocs.personal-document-restore': { path: '/v1/enterprise/codocs/personal-documents:restore', capability: 'codocs:personal-documents:edit' },
  'codocs.personal-document-check-name': { path: '/v1/enterprise/codocs/personal-documents:check-name', capability: 'codocs:personal-documents:read' },
  'codocs.personal-document-create': { path: '/v1/enterprise/codocs/personal-documents:create', capability: 'codocs:personal-documents:create' },
  'codocs.document-access-record': { path: '/v1/enterprise/codocs/document-access-records:record', capability: 'codocs:document-access-records:record' },
  'codocs.personal-document-list': { path: '/v1/enterprise/codocs/personal-documents:list', capability: 'codocs:personal-documents:read' },
  'codocs.personal-document-edit-metadata': { path: '/v1/enterprise/codocs/personal-documents:edit-metadata', capability: 'codocs:personal-documents:edit' },
  'codocs.personal-document-view': { path: '/v1/enterprise/codocs/personal-documents:view', capability: 'codocs:personal-documents:read' },
  'codocs.personal-document-download': { path: '/v1/enterprise/codocs/personal-documents:download', capability: 'codocs:personal-documents:export' },
  'codocs.personal-document-trash': { path: '/v1/enterprise/codocs/personal-documents:trash', capability: 'codocs:personal-documents:read' },
  'codocs.personal-folder-list': { path: '/v1/enterprise/codocs/personal-documents:folders', capability: 'codocs:personal-documents:read' },
  'codocs.personal-folder-view': { path: '/v1/enterprise/codocs/personal-folders:view', capability: 'codocs:personal-folders:read' },
  'codocs.personal-folder-create': { path: '/v1/enterprise/codocs/personal-folders:create', capability: 'codocs:personal-folders:create' },
  'codocs.personal-folder-update': { path: '/v1/enterprise/codocs/personal-folders:update', capability: 'codocs:personal-folders:edit' },
  'codocs.personal-folder-delete': { path: '/v1/enterprise/codocs/personal-folders:delete', capability: 'codocs:personal-folders:delete' },
  'altoc.contracts-activate-delivery': { path: '/v1/enterprise/altoc/contracts:activate-delivery', capability: 'altoc:contract:activate-delivery' },
  'assets.product-categories-admin': { path: '/v1/enterprise/assets/product-categories:admin-list', capability: 'assets:admin:admin' },
  'assets.product-categories-save': { path: '/v1/enterprise/assets/product-categories:save', capability: 'assets:admin:admin' },
  'assets.products-link-base': { path: '/v1/enterprise/assets/products:link-base', capability: 'assets:product:edit' },
  'assets.products-link-asset': { path: '/v1/enterprise/assets/products:link-asset', capability: 'assets:product:edit' },
  'assets.products-link-document': { path: '/v1/enterprise/assets/products:link-document', capability: 'assets:product:edit' },
  'assets.products-base-candidates': { path: '/v1/enterprise/assets/products:base-candidates', capability: 'assets:product:read' },
  'assets.products-asset-candidates': { path: '/v1/enterprise/assets/products:asset-candidates', capability: 'assets:product:read' },
  'assets.products-create': { path: '/v1/enterprise/assets/products:create', capability: 'assets:product:edit' },
  'assets.products-edit': { path: '/v1/enterprise/assets/products:edit', capability: 'assets:product:edit' },
  'assets.products-list': { path: '/v1/enterprise/assets/products:list', capability: 'assets:product:read' },
  'assets.products-view': { path: '/v1/enterprise/assets/products:view', capability: 'assets:product:read' },
  'assets.product-dictionaries': { path: '/v1/enterprise/assets/product-dictionaries:list', capability: 'assets:product:read' },
  'assets.product-categories': { path: '/v1/enterprise/assets/product-categories:list', capability: 'assets:product:read' },
  'assets.asset-dictionaries': { path: '/v1/enterprise/assets/dictionaries:list', capability: 'assets:asset-item:read' },
  'assets.asset-items-list': { path: '/v1/enterprise/assets/assets:list', capability: 'assets:asset-item:read' },
  'assets.asset-items-view': { path: '/v1/enterprise/assets/assets:view', capability: 'assets:asset-item:read' },
  'assets.digital-assets-list': { path: '/v1/enterprise/assets/digital-assets:list', capability: 'assets:digital-asset:read' },
  'assets.digital-assets-view': { path: '/v1/enterprise/assets/digital-assets:view', capability: 'assets:digital-asset:read' },
	'assets.digital-assets-create': { path: '/v1/enterprise/assets/digital-assets:create', capability: 'assets:digital-asset:create' },
	'assets.digital-assets-edit': { path: '/v1/enterprise/assets/digital-assets:edit', capability: 'assets:digital-asset:edit' },
	'assets.ip-assets-list': { path: '/v1/enterprise/assets/ip-assets:list', capability: 'assets:ip-asset:read' },
	'assets.ip-assets-view': { path: '/v1/enterprise/assets/ip-assets:view', capability: 'assets:ip-asset:read' },
	'assets.ip-assets-create': { path: '/v1/enterprise/assets/ip-assets:create', capability: 'assets:ip-asset:create' },
	'assets.ip-assets-edit': { path: '/v1/enterprise/assets/ip-assets:edit', capability: 'assets:ip-asset:edit' },

  'aims.handoff-detail': { path: '/v1/enterprise/aims/handoff:detail', capability: 'aims:product-priorities:read' },
  'aims.handoff-projects': { path: '/v1/enterprise/aims/handoff:projects', capability: 'aims:product-priorities:project-authorization' },
  'aims.handoff-requirements': { path: '/v1/enterprise/aims/handoff:requirements', capability: 'aims:product-priorities:project-authorization' },
  'aims.handoff-project-authorization': { path: '/v1/enterprise/aims/handoff:project-authorization', capability: 'aims:product-priorities:project-authorization' },
  'aims.handoff-create': { path: '/v1/enterprise/aims/handoff:create', capability: 'aims:product-priorities:handoff' },

  'aims.version-execution-coordination': { path: '/v1/enterprise/aims/product-version:execution-coordination', capability: 'aims:product-versions:read' },
  'aims.version-acceptance-list': { path: '/v1/enterprise/aims/product-version:acceptance-list', capability: 'aims:product-versions:read' },
  'aims.version-acceptance-view': { path: '/v1/enterprise/aims/product-version:acceptance-view', capability: 'aims:product-versions:read' },
  'aims.version-release-list': { path: '/v1/enterprise/aims/product-version:release-list', capability: 'aims:product-versions:read' },
  'aims.version-release-view': { path: '/v1/enterprise/aims/product-version:release-view', capability: 'aims:product-versions:read' },

  'aims.feature-cycles': { path: '/v1/enterprise/aims/features:cycles', capability: 'aims:product-priorities:read' },
  'aims.feature-list': { path: '/v1/enterprise/aims/features:list', capability: 'aims:product-features:read' },
  'aims.feature-view': { path: '/v1/enterprise/aims/features:view', capability: 'aims:product-features:read' },
  'aims.feature-create': { path: '/v1/enterprise/aims/features:create', capability: 'aims:product-features:create' },
  'aims.feature-edit': { path: '/v1/enterprise/aims/features:edit', capability: 'aims:product-features:edit' },
  'aims.feature-delete': { path: '/v1/enterprise/aims/features:delete', capability: 'aims:product-features:delete' },
  'aims.feature-component-assign': { path: '/v1/enterprise/aims/features:component-assign', capability: 'aims:product-features:component-assign' },
  'aims.feature-lifecycle': { path: '/v1/enterprise/aims/features:lifecycle', capability: 'aims:product-features:lifecycle' },
  'aims.feature-request-list': { path: '/v1/enterprise/aims/features:request-list', capability: 'aims:product-features:read' },
  'aims.feature-request-link': { path: '/v1/enterprise/aims/features:request-link', capability: 'aims:product-features:request-link' },
  'aims.feature-roadmap': { path: '/v1/enterprise/aims/features:roadmap', capability: 'aims:product-priorities:read' },
  'aims.feature-unscheduled': { path: '/v1/enterprise/aims/features:unscheduled', capability: 'aims:product-priorities:read' },

  'aims.component-create': { path: '/v1/enterprise/aims/components:create', capability: 'aims:product-components:create' },
  'aims.component-edit': { path: '/v1/enterprise/aims/components:edit', capability: 'aims:product-components:edit' },
  'aims.component-move': { path: '/v1/enterprise/aims/components:move', capability: 'aims:product-components:move' },
  'aims.component-delete': { path: '/v1/enterprise/aims/components:delete', capability: 'aims:product-components:delete' },
  'aims.onboard-candidates': { path: '/v1/enterprise/aims/product-onboard:candidates', capability: 'aims:products:onboard' },
  'aims.onboard-candidate': { path: '/v1/enterprise/aims/product-onboard:candidate', capability: 'aims:products:onboard' },
  'aims.onboard-line-candidates': { path: '/v1/enterprise/aims/product-line-onboard:candidates', capability: 'aims:products:onboard' },
  'aims.product-onboard': { path: '/v1/enterprise/aims/product-onboard', capability: 'aims:products:onboard' },
  'aims.product-line-onboard': { path: '/v1/enterprise/aims/product-line-onboard', capability: 'aims:products:onboard' },
 'aims.request-merge': { path: '/v1/enterprise/aims/product-requests:merge', capability: 'aims:product-requests:merge' },
  'aims.request-edit': { path: '/v1/enterprise/aims/product-requests:edit', capability: 'aims:product-requests:edit' },
  'aims.request-decide': { path: '/v1/enterprise/aims/product-requests:decide', capability: 'aims:product-requests:decide' },
  'aims.request-source-list': { path: '/v1/enterprise/aims/request-sources:list', capability: 'aims:product-requests:read' },
  'aims.request-source-create': { path: '/v1/enterprise/aims/request-sources:create', capability: 'aims:product-requests:source-create' },
  'aims.request-source-delete': { path: '/v1/enterprise/aims/request-sources:delete', capability: 'aims:product-requests:source-delete' },

  'aims.product-workspace-view': { path: '/v1/enterprise/aims/product-workspace:view', capability: 'aims:products:view' },
  // Project management is deliberately registered separately from the product
  // workspace.  The Host never forwards an arbitrary Aims path to Runtime.
  'aims.project-list': { path: '/v1/enterprise/aims/projects:list', capability: 'aims:projects:view' },
  'aims.project-view': { path: '/v1/enterprise/aims/projects:view', capability: 'aims:projects:view' },
  'aims.project-create': { path: '/v1/enterprise/aims/projects:create', capability: 'aims:project-create:execute' },
  'aims.project-edit': { path: '/v1/enterprise/aims/projects:update', capability: 'aims:project-edit:execute' },
  'aims.project-member-add': { path: '/v1/enterprise/aims/project-members:add', capability: 'aims:project-member-add:execute' },
  'aims.project-member-role': { path: '/v1/enterprise/aims/project-members:role', capability: 'aims:project-member-role:execute' },
  'aims.project-member-remove': { path: '/v1/enterprise/aims/project-members:remove', capability: 'aims:project-member-remove:execute' },
  'aims.work-item-create': { path: '/v1/enterprise/aims/work-items:create', capability: 'aims:work-item-create:execute' },
  'aims.work-item-edit': { path: '/v1/enterprise/aims/work-items:edit', capability: 'aims:work-item-edit:execute' },
  'aims.work-item-delete': { path: '/v1/enterprise/aims/work-items:delete', capability: 'aims:work-item-delete:execute' },
  'aims.work-item-associate': { path: '/v1/enterprise/aims/work-items:associate', capability: 'aims:work-item-associate:execute' },
  'aims.work-item-complete': { path: '/v1/enterprise/aims/work-items:complete', capability: 'aims:work-item-complete:execute' },
  'aims.work-item-start': { path: '/v1/enterprise/aims/work-items:start', capability: 'aims:work-item-start:execute' },
  'aims.work-item-reset': { path: '/v1/enterprise/aims/work-items:reset', capability: 'aims:work-item-reset:execute' },
  'aims.work-item-reopen': { path: '/v1/enterprise/aims/work-items:reopen', capability: 'aims:work-item-reopen:execute' },
  'aims.work-item-confirm-distribute': { path: '/v1/enterprise/aims/work-items:confirm-distribute', capability: 'aims:work-item-distribute-confirm:execute' },
  'aims.work-item-revoke-distribute': { path: '/v1/enterprise/aims/work-items:revoke-distribute', capability: 'aims:work-item-distribute-revoke:execute' },
  'aims.work-item-confirm-append': { path: '/v1/enterprise/aims/work-items:confirm-append', capability: 'aims:work-item-append-confirm:execute' },
  'aims.work-item-reject-append': { path: '/v1/enterprise/aims/work-items:reject-append', capability: 'aims:work-item-append-reject:execute' },
  'aims.work-item-append-tasks': { path: '/v1/enterprise/aims/work-items:append-tasks', capability: 'aims:work-item-append-tasks:execute' },
  'aims.work-item-breakdown': { path: '/v1/enterprise/aims/work-items:breakdown', capability: 'aims:work-item-breakdown:execute' },
  'aims.work-item-completion-replay': { path: '/v1/enterprise/aims/work-items:completion-replay', capability: 'aims:work-item-completion-replay:execute' },
  'aims.work-item-list': { path: '/v1/enterprise/aims/work-items:list', capability: 'aims:work-items:view' },
  'aims.work-item-view': { path: '/v1/enterprise/aims/work-items:view', capability: 'aims:work-items:view' },
  'aims.work-item-breakdown-context': { path: '/v1/enterprise/aims/work-items:breakdown-context', capability: 'aims:work-items:view' },
  'aims.time-entry-list': { path: '/v1/enterprise/aims/time-entries:list', capability: 'aims:time-entries:view' },
  'aims.time-entry-view': { path: '/v1/enterprise/aims/time-entries:view', capability: 'aims:time-entries:view' },
  'aims.weekly-report-list': { path: '/v1/enterprise/aims/weekly-reports:list', capability: 'aims:weekly-reports:view' },
  'aims.weekly-report-view': { path: '/v1/enterprise/aims/weekly-reports:view', capability: 'aims:weekly-reports:view' },
  'aims.project-member-list': { path: '/v1/enterprise/aims/project-members:list', capability: 'aims:project-members:view' },
  'aims.project-requirement-list': { path: '/v1/enterprise/aims/project-requirements:list', capability: 'aims:requirements:view' },
  'aims.project-requirement-view': { path: '/v1/enterprise/aims/project-requirements:view', capability: 'aims:requirements:view' },
  'aims.project-plan-milestones': { path: '/v1/enterprise/aims/project-plan:milestones', capability: 'aims:project-plan:view' },
  'aims.project-plan-items': { path: '/v1/enterprise/aims/project-plan:items', capability: 'aims:project-plan:view' },
  'aims.project-board-view': { path: '/v1/enterprise/aims/project-board:view', capability: 'aims:project-board:view' },
  'aims.timesheet-overview': { path: '/v1/enterprise/aims/timesheet-overview:view', capability: 'aims:timesheet-overview:view' },
  'aims.weekly-report-overview': { path: '/v1/enterprise/aims/weekly-report-overview:view', capability: 'aims:weekly-report-overview:view' },
  'aims.component-list': { path: '/v1/enterprise/aims/components:list', capability: 'aims:product-components:read' },
  'aims.version-plan': { path: '/v1/enterprise/aims/versions:plan', capability: 'aims:product-versions:read' },
  'aims.version-plan-items': { path: '/v1/enterprise/aims/versions:plan-items', capability: 'aims:product-versions:read' },
  'aims.version-list': { path: '/v1/enterprise/aims/versions:list', capability: 'aims:product-versions:read' },
  'aims.version-view': { path: '/v1/enterprise/aims/versions:view', capability: 'aims:product-versions:read' },
  'aims.product-list': { path: '/v1/enterprise/aims/product-list', capability: 'aims:products:view' },
  'aims.version-accept': { path: '/v1/enterprise/aims/product-version:accept', capability: 'aims:product-versions:accept' },
  'aims.version-publish': { path: '/v1/enterprise/aims/product-version:publish', capability: 'aims:product-versions:publish' },
  'aims.version-acceptance-preview': { path: '/v1/enterprise/aims/product-version:acceptance-preview', capability: 'aims:product-versions:read' },
  'aims.version-execution-project-authorization': { path: '/v1/enterprise/aims/product-version:execution-project-authorization', capability: 'aims:product-versions:read' },
  'aims.version-edit': { path: '/v1/enterprise/aims/product-version:edit', capability: 'aims:product-versions:edit' },
  'aims.version-delete': { path: '/v1/enterprise/aims/product-version:delete', capability: 'aims:product-versions:delete' },
  'aims.version-transition': { path: '/v1/enterprise/aims/product-version:transition', capability: 'aims:product-versions:edit' },
  'aims.version-reopen': { path: '/v1/enterprise/aims/product-version:reopen', capability: 'aims:product-versions:reopen' },
  'aims.version-archive': { path: '/v1/enterprise/aims/product-version:archive', capability: 'aims:product-versions:archive' },
  'aims.version-create': { path: '/v1/enterprise/aims/versions:create', capability: 'aims:product-versions:create' },
  'aims.version-plan-edit': { path: '/v1/enterprise/aims/versions:plan-edit', capability: 'aims:product-versions:edit' },
  'aims.version-plan-item-create': { path: '/v1/enterprise/aims/versions:plan-item-create', capability: 'aims:product-versions:edit' },
  'aims.version-plan-item-edit': { path: '/v1/enterprise/aims/versions:plan-item-edit', capability: 'aims:product-versions:edit' },
  'aims.version-plan-item-delete': { path: '/v1/enterprise/aims/versions:plan-item-delete', capability: 'aims:product-versions:edit' },
  'aims.version-plan-confirm': { path: '/v1/enterprise/aims/versions:plan-confirm', capability: 'aims:product-versions:edit' },
  'aims.product-request-list': { path: '/v1/enterprise/aims/product-requests:list', capability: 'aims:product-requests:read' },
  'aims.product-request-view': { path: '/v1/enterprise/aims/product-requests:view', capability: 'aims:product-requests:read' },
  'aims.product-authorization': { path: '/v1/enterprise/aims/product-authorization', capability: 'aims:products:authorization-object' },
  'aims.product-request-create': { path: '/v1/enterprise/aims/product-requests:create', capability: 'aims:product-requests:create' },
  'assets.product-directory': { path: '/v1/enterprise/assets/product-directory', capability: 'assets:product:read' },
  'assets.product-directory-resolve': { path: '/v1/enterprise/assets/product-directory:resolve', capability: 'assets:product:read' },
  // 工作项细化与执行（第一批）：全部委托给既有 Aims handler，capability 按子资源拆分。
  'aims.work-item-comment-list': { path: '/v1/enterprise/aims/work-item-comments:view', capability: 'aims:work-item-comments:view' },
  'aims.work-item-comment-create': { path: '/v1/enterprise/aims/work-item-comments:create', capability: 'aims:work-item-comments:edit' },
  'aims.work-item-commit-list': { path: '/v1/enterprise/aims/work-item-commits:view', capability: 'aims:work-item-commits:view' },
  'aims.work-item-commit-link': { path: '/v1/enterprise/aims/work-item-commits:link', capability: 'aims:work-item-commits:edit' },
  'aims.work-item-commit-unlink': { path: '/v1/enterprise/aims/work-item-commits:unlink', capability: 'aims:work-item-commits:edit' },
  'aims.work-item-document-list': { path: '/v1/enterprise/aims/work-item-documents:view', capability: 'aims:work-item-documents:view' },
  'aims.work-item-document-link': { path: '/v1/enterprise/aims/work-item-documents:link', capability: 'aims:work-item-documents:edit' },
  'aims.work-item-document-unlink': { path: '/v1/enterprise/aims/work-item-documents:unlink', capability: 'aims:work-item-documents:edit' },
  'aims.work-item-document-unlink-current': { path: '/v1/enterprise/aims/work-item-documents:unlink-current', capability: 'aims:work-item-documents:edit' },
  'aims.work-item-time-entry-list': { path: '/v1/enterprise/aims/work-item-time-entries:view', capability: 'aims:work-item-time-entries:view' },
  'aims.work-item-time-entry-create': { path: '/v1/enterprise/aims/work-item-time-entries:create', capability: 'aims:work-item-time-entries:edit' },
  'aims.work-item-time-entry-update': { path: '/v1/enterprise/aims/work-item-time-entries:update', capability: 'aims:work-item-time-entries:edit' },
  'aims.work-item-time-entry-delete': { path: '/v1/enterprise/aims/work-item-time-entries:delete', capability: 'aims:work-item-time-entries:edit' },
  'aims.work-item-transitions': { path: '/v1/enterprise/aims/work-item-execution:transitions', capability: 'aims:work-item-execution:view' },
  'aims.work-item-execution-context': { path: '/v1/enterprise/aims/work-item-execution:context', capability: 'aims:work-item-execution:view' },
  'aims.work-item-source-sections': { path: '/v1/enterprise/aims/work-item-execution:source-sections', capability: 'aims:work-item-execution:view' },
  'aims.work-item-decompose-context': { path: '/v1/enterprise/aims/work-item-execution:decompose-context', capability: 'aims:work-item-execution:view' },
  'aims.work-item-children': { path: '/v1/enterprise/aims/work-item-execution:children', capability: 'aims:work-item-execution:view' },
  'aims.work-item-decompose-submit': { path: '/v1/enterprise/aims/work-item-decomposition:submit', capability: 'aims:work-item-decomposition:edit' },
  'aims.work-item-clone-from-template': { path: '/v1/enterprise/aims/work-item-decomposition:clone-from-template', capability: 'aims:work-item-decomposition:edit' },
  'aims.work-item-deliverable-update': { path: '/v1/enterprise/aims/work-item-deliverables:update', capability: 'aims:work-item-deliverables:edit' },
  'aims.work-item-batch-update': { path: '/v1/enterprise/aims/work-item-batch:update', capability: 'aims:work-item-batch:edit' },
  // 项目线共享依赖（第 0 批）：useProjectStore 与 ProjectNavbar 的前提。
  'aims.project-favorite-list': { path: '/v1/enterprise/aims/project-favorites:view', capability: 'aims:project-favorites:view' },
  'aims.project-favorite-add': { path: '/v1/enterprise/aims/project-favorites:add', capability: 'aims:project-favorites:edit' },
  'aims.project-favorite-remove': { path: '/v1/enterprise/aims/project-favorites:remove', capability: 'aims:project-favorites:edit' },
  'aims.project-repo-list': { path: '/v1/enterprise/aims/project-repos:view', capability: 'aims:project-repos:view' },
  'aims.project-repo-link': { path: '/v1/enterprise/aims/project-repos:link', capability: 'aims:project-repos:edit' },
  'aims.project-repo-unlink': { path: '/v1/enterprise/aims/project-repos:unlink', capability: 'aims:project-repos:edit' },
  'aims.project-work-item-list': { path: '/v1/enterprise/aims/project-work-items:list', capability: 'aims:project-work-items:view' },
  // 交付物与项目版本（第 2 批）：项目工作项页的剩余依赖。
  'aims.project-deliverable-list': { path: '/v1/enterprise/aims/project-deliverables:list', capability: 'aims:project-deliverables:view' },
  'aims.project-deliverable-update': { path: '/v1/enterprise/aims/project-deliverables:update', capability: 'aims:project-deliverables:edit' },
  'aims.project-deliverable-delete': { path: '/v1/enterprise/aims/project-deliverables:delete', capability: 'aims:project-deliverables:edit' },
  'aims.project-deliverable-batch-create': { path: '/v1/enterprise/aims/project-deliverables:batch-create', capability: 'aims:project-deliverables:edit' },
  'aims.project-release-list': { path: '/v1/enterprise/aims/project-releases:list', capability: 'aims:project-releases:view' },
  // 里程碑：useMilestoneStore 的读写，项目工作项页的传递依赖。
  'aims.project-milestone-list': { path: '/v1/enterprise/aims/project-milestones:list', capability: 'aims:project-milestones:view' },
  'aims.project-milestone-create': { path: '/v1/enterprise/aims/project-milestones:create', capability: 'aims:project-milestones:edit' },
  'aims.project-milestone-update': { path: '/v1/enterprise/aims/project-milestones:update', capability: 'aims:project-milestones:edit' },
  'aims.project-milestone-delete': { path: '/v1/enterprise/aims/project-milestones:delete', capability: 'aims:project-milestones:edit' },
  'aims.project-routine-review': { path: '/v1/enterprise/aims/project-routine-review:view', capability: 'aims:project-routine-review:view' },
  // 项目集与项目删除：项目列表页依赖。删除是破坏性动作，单独 capability。
  'aims.project-portfolio-list': { path: '/v1/enterprise/aims/project-portfolios:list', capability: 'aims:project-portfolios:view' },
  'aims.project-portfolio-create': { path: '/v1/enterprise/aims/project-portfolios:create', capability: 'aims:project-portfolios:edit' },
  'aims.project-portfolio-update': { path: '/v1/enterprise/aims/project-portfolios:update', capability: 'aims:project-portfolios:edit' },
  'aims.project-portfolio-delete': { path: '/v1/enterprise/aims/project-portfolios:delete', capability: 'aims:project-portfolios:edit' },
  'aims.project-delete': { path: '/v1/enterprise/aims/project-deletion:execute', capability: 'aims:project-deletion:execute' },
  // 工时与任务中心：全局任务中心、项目工时、全局工时三页的依赖。
  'aims.my-work-item-list': { path: '/v1/enterprise/aims/my-work-items:list', capability: 'aims:my-work-items:view' },
  'aims.time-entry-review-list': { path: '/v1/enterprise/aims/time-entry-reviews:list', capability: 'aims:time-entry-reviews:view' },
  'aims.time-entry-review-submit': { path: '/v1/enterprise/aims/time-entry-reviews:submit', capability: 'aims:time-entry-reviews:edit' },
  'aims.user-time-entry-list': { path: '/v1/enterprise/aims/user-time-entries:list', capability: 'aims:user-time-entries:view' },
  'aims.project-time-entry-create': { path: '/v1/enterprise/aims/project-time-entries:create', capability: 'aims:project-time-entries:edit' },
  'aims.project-time-entry-update': { path: '/v1/enterprise/aims/project-time-entries:update', capability: 'aims:project-time-entries:edit' },
  'aims.project-time-entry-delete': { path: '/v1/enterprise/aims/project-time-entries:delete', capability: 'aims:project-time-entries:edit' },
  'aims.timesheet-week-submit': { path: '/v1/enterprise/aims/timesheet-weeks:submit', capability: 'aims:timesheet-weeks:edit' },
  // 全局周报页：公司周报汇总、周期治理、周报审阅。
  'aims.company-weekly-summary-view': { path: '/v1/enterprise/aims/company-weekly-summaries:view', capability: 'aims:company-weekly-summaries:view' },
  'aims.company-weekly-summary-versions': { path: '/v1/enterprise/aims/company-weekly-summaries:versions', capability: 'aims:company-weekly-summaries:view' },
  'aims.company-weekly-summary-save-draft': { path: '/v1/enterprise/aims/company-weekly-summaries:save-draft', capability: 'aims:company-weekly-summaries:edit' },
  'aims.company-weekly-summary-generate': { path: '/v1/enterprise/aims/company-weekly-summaries:generate', capability: 'aims:company-weekly-summaries:edit' },
  'aims.company-weekly-summary-publish': { path: '/v1/enterprise/aims/company-weekly-summaries:publish', capability: 'aims:company-weekly-summaries:edit' },
  'aims.company-weekly-summary-cancel-publish': { path: '/v1/enterprise/aims/company-weekly-summaries:cancel-publish', capability: 'aims:company-weekly-summaries:edit' },
  'aims.company-weekly-summary-open-correction': { path: '/v1/enterprise/aims/company-weekly-summaries:open-correction', capability: 'aims:company-weekly-summaries:edit' },
  'aims.company-weekly-summary-retry': { path: '/v1/enterprise/aims/company-weekly-summaries:retry', capability: 'aims:company-weekly-summaries:edit' },
  'aims.weekly-reporting-period-workbench': { path: '/v1/enterprise/aims/weekly-reporting-periods:director-workbench', capability: 'aims:weekly-reporting-periods:view' },
  'aims.weekly-reporting-period-generate': { path: '/v1/enterprise/aims/weekly-reporting-periods:generate', capability: 'aims:weekly-reporting-periods:edit' },
  'aims.weekly-report-review': { path: '/v1/enterprise/aims/weekly-report-review:review', capability: 'aims:weekly-report-review:edit' },
  'aims.weekly-report-open-correction': { path: '/v1/enterprise/aims/weekly-report-review:open-correction', capability: 'aims:weekly-report-review:edit' },
  // 项目计划页：模板版本、里程碑周期开启、需求目标。
  'aims.project-template-version-list': { path: '/v1/enterprise/aims/project-template-versions:list', capability: 'aims:project-template-versions:view' },
  'aims.project-template-version-view': { path: '/v1/enterprise/aims/project-template-versions:view', capability: 'aims:project-template-versions:view' },
  'aims.milestone-rollover': { path: '/v1/enterprise/aims/milestone-rollover:execute', capability: 'aims:milestone-rollover:execute' },
  'aims.requirement-target-create': { path: '/v1/enterprise/aims/requirement-targets:create', capability: 'aims:requirement-targets:edit' },
  // 工作项执行页的 GitLab 依赖；diff 内容由宿主直连 GitLab，Runtime 只给元数据与写回。
  'aims.project-gitlab-commits': { path: '/v1/enterprise/aims/project-gitlab:commits', capability: 'aims:project-gitlab:view' },
  'aims.project-gitlab-sync-context': { path: '/v1/enterprise/aims/project-gitlab:sync-context', capability: 'aims:project-gitlab:view' },
  'aims.project-gitlab-commit-ingest': { path: '/v1/enterprise/aims/project-gitlab:commit-ingest', capability: 'aims:project-gitlab:edit' },
  'aims.work-item-commit-diff-metadata': { path: '/v1/enterprise/aims/work-item-commit-diff:metadata', capability: 'aims:work-item-commit-diff:view' },
  'aims.work-item-commit-files-changed': { path: '/v1/enterprise/aims/work-item-commit-diff:files-changed', capability: 'aims:work-item-commit-diff:edit' },
  'aims.project-weekly-report-save-draft': { path: '/v1/enterprise/aims/project-weekly-report-period:save-draft', capability: 'aims:project-weekly-report-period:edit' },
  'aims.project-weekly-report-submit': { path: '/v1/enterprise/aims/project-weekly-report-period:submit', capability: 'aims:project-weekly-report-period:edit' },
  'assets.product-adoption-read': { path: '/v1/enterprise/assets/product-adoption:read', capability: 'assets:product-adoption:read' }
} as const

export async function requireEnterpriseUser(event: H3Event) {
  const config = useRuntimeConfig(event) as { public?: { appCode?: string }, hzy?: { appCode?: string } }
  if (config.public?.appCode !== 'enterprise' || (config.hzy?.appCode && config.hzy.appCode !== 'enterprise')) {
    throw createError({ statusCode: 503, message: 'Enterprise host identity is not configured.' })
  }
  const auth = await resolveConsoleAuthWithSessionBridge(event)
  if (!auth.authenticated || auth.tokenUse !== 'access' || auth.subjectType !== 'user' || !auth.uid || !auth.tenant || !auth.deployment) {
    throw createError({ statusCode: 401, message: 'An authenticated enterprise user session is required.' })
  }
  event.context.consoleAuth = auth
  // A user access token identifies its Console issuer deployment. Business
  // permits instead bind to this Host, using authenticated gateway context.
  // Keep the original session untouched for actor delegation and validation.
  const gateway = resolveTrustedTenantGatewayContext(event)
  if (gateway && (gateway.appCode !== 'enterprise' || gateway.tenant !== auth.tenant || !gateway.deployment)) {
    throw createError({ statusCode: 403, message: 'Enterprise host binding does not match the user tenant.' })
  }
  return { ...auth, deployment: gateway?.deployment || auth.deployment } as typeof auth & { uid: string, tenant: string, deployment: string }
}

function enterpriseRuntimeCallOptions(route: { capability: string }) {
  return {
    appCode: 'enterprise', scope: route.capability, capabilityFormat: 'business' as const,
    serviceTokenSourceBinding: 'service-client-policy' as const, method: 'POST', query: {}
  }
}

/**
 * Enterprise Runtime accepts permits no more than 15 seconds in the future.
 * Keep one second inside that maximum so independent Worker and Runtime clocks
 * cannot turn an otherwise fresh permit into a future-bound permit.
 */
export function enterpriseRuntimePermitExpiresAt(now = Date.now()) {
  return now + enterpriseRuntimePermitTtlMs
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

const enterprisePermitFields = new Set([
  'authorization', 'assets_authorization', 'baseAuthorization', 'assetAuthorization',
  'targetAuthorization', 'documentAuthorization', 'planning_authorization',
  'requestAuthorization', 'request_authorization', 'versionAuthorization',
  'version_authorization', 'projectAuthorization', 'project_authorization',
  'request_decision_authorization', 'feature_authorization', 'aims_authorization',
  'predecessor_authorization', 'predecessor_authorizations'
])

function capEnterprisePermit(value: unknown, now: number, ceiling: number): unknown {
  if (Array.isArray(value)) return value.map(item => capEnterprisePermit(item, now, ceiling))
  const record = recordValue(value)
  if (!record) return value
  return Object.fromEntries(Object.entries(record).map(([key, item]) => {
    if ((key === 'expiresAt' || key === 'expires_at') && typeof item === 'number'
      && item > ceiling && item <= now + 15_000) {
      return [key, ceiling]
    }
    return [key, item]
  }))
}

/**
 * Host bridges may construct an explicit permit before entering this client.
 * Cap only a legal 14–15 second permit to the shorter window; already-expired
 * and malformed/future values stay untouched for Runtime to reject.
 */
export function capEnterpriseRuntimePermitExpiries(body: unknown, now = Date.now()) {
  const record = recordValue(body)
  if (!record) return body
  const ceiling = enterpriseRuntimePermitExpiresAt(now)
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [
    key,
    enterprisePermitFields.has(key) ? capEnterprisePermit(value, now, ceiling) : value
  ]))
}

/**
 * Obtain the exact Runtime service token before a short-lived user permit is
 * timestamped.  Callers use this only on handlers that otherwise construct a
 * permit before their first Runtime operation.
 */
export async function prepareEnterpriseRuntime(event: H3Event, operation: keyof typeof operations) {
  await requireEnterpriseUser(event)
  const route = operations[operation]
  if (!route) throw createError({ statusCode: 503, message: 'Enterprise operation is not registered.' })

  const options = enterpriseRuntimeCallOptions(route)
  if (!await tenantRuntimeClient.prepareTenantRuntime(event, options)) {
    throw createError({ statusCode: 503, message: 'Enterprise runtime is unavailable.' })
  }
}

export async function callEnterpriseRuntime<T>(event: H3Event, operation: keyof typeof operations, body: unknown, options: { idempotencyKey?: string } = {}): Promise<T> {
  await requireEnterpriseUser(event)
  const route = operations[operation]
  if (!route) throw createError({ statusCode: 503, message: 'Enterprise operation is not registered.' })
  const response = await tenantRuntimeClient.maybeCallTenantRuntime<T>(event, route.path, {
    ...enterpriseRuntimeCallOptions(route), body: capEnterpriseRuntimePermitExpiries(body), idempotencyKey: options.idempotencyKey
  })
  if (!response.handled) throw createError({ statusCode: 503, message: 'Enterprise runtime is unavailable.' })
  return response.data
}
