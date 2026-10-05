import { createError, type H3Event } from 'h3'
import { resolveConsoleAuthWithSessionBridge } from './consoleSessionBridge'
import * as tenantRuntimeClient from './tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from './tenantGatewayTrust'
import { enterpriseErrorMessage, safeEnterpriseErrorCode } from '../../shared/utils/enterpriseBusinessError'

const enterpriseRuntimePermitTtlMs = 14_000

// Business handlers select a registered operation in server code. Neither a
// browser path parameter nor forwarded app headers choose a runtime identity.
const operations = {
  'console.org-brand-view': { path: '/v1/enterprise/console/org-brand:view' },
  'console.directory-self-departments': { path: '/v1/enterprise/console/directory-self:departments' },
  'console.directory-self-projects': { path: '/v1/enterprise/console/directory-self:projects' },
  'console.directory-self-accessible-departments': { path: '/v1/enterprise/console/directory-self:accessible-departments' },
  'codocs.collab-document-list': { path: '/v1/enterprise/codocs/collab-documents:list' },
  'codocs.collab-document-list-admin': { path: '/v1/enterprise/codocs/collab-documents:list-admin' },
  'codocs.publish-execution-seal': { path: '/v1/enterprise/codocs/publish-execution:seal' },
  'codocs.publish-execution-send': { path: '/v1/enterprise/codocs/publish-execution:send' },
  'codocs.publish-execution-receive': { path: '/v1/enterprise/codocs/publish-execution:receive' },
  'codocs.document-share-list': { path: '/v1/enterprise/codocs/document-shares:list' },
  'codocs.document-share-mark-read': { path: '/v1/enterprise/codocs/document-shares:mark-read' },
  'codocs.document-share-create': { path: '/v1/enterprise/codocs/document-shares:create' },
  'codocs.document-share-update': { path: '/v1/enterprise/codocs/document-shares:update' },
  'codocs.document-share-delete': { path: '/v1/enterprise/codocs/document-shares:delete' },
  'codocs.review-history-by-document': { path: '/v1/enterprise/codocs/review-history:by-document' },
  'codocs.review-history-by-oss-path': { path: '/v1/enterprise/codocs/review-history:by-oss-path' },
  'codocs.review-history-company-by-oss-path': { path: '/v1/enterprise/codocs/review-history:company-by-oss-path' },
  'codocs.document-annotations-list': { path: '/v1/enterprise/codocs/document-annotations:list' },
  'codocs.document-annotations-create': { path: '/v1/enterprise/codocs/document-annotations:create' },
  'codocs.document-annotations-update': { path: '/v1/enterprise/codocs/document-annotations:update' },
  'codocs.document-annotation-reply-create': { path: '/v1/enterprise/codocs/document-annotations:reply-create' },
  'codocs.document-annotation-reply-delete': { path: '/v1/enterprise/codocs/document-annotations:reply-delete' },
  'codocs.personal-cabinet-list': { path: '/v1/enterprise/codocs/personal-cabinet:list' },
  'codocs.department-access-resolve': { path: '/v1/enterprise/codocs/department-access:resolve' },
  'codocs.department-documents-list': { path: '/v1/enterprise/codocs/department-documents:list' },
  'codocs.department-documents-trash': { path: '/v1/enterprise/codocs/department-documents:trash' },
  'codocs.department-documents-view': { path: '/v1/enterprise/codocs/department-documents:view' },
  'codocs.department-documents-download': { path: '/v1/enterprise/codocs/department-documents:download' },
  'codocs.department-documents-create': { path: '/v1/enterprise/codocs/department-documents:create' },
  'codocs.department-documents-edit-metadata': { path: '/v1/enterprise/codocs/department-documents:edit-metadata' },
  'codocs.department-documents-readonly': { path: '/v1/enterprise/codocs/department-documents:readonly' },
  'codocs.department-documents-recycle': { path: '/v1/enterprise/codocs/department-documents:recycle' },
  'codocs.department-documents-restore-plan': { path: '/v1/enterprise/codocs/department-documents:restore-plan' },
  'codocs.department-documents-restore': { path: '/v1/enterprise/codocs/department-documents:restore' },
  'codocs.department-folders-list': { path: '/v1/enterprise/codocs/department-folders:list' },
  'codocs.department-folders-create': { path: '/v1/enterprise/codocs/department-folders:create' },
  'codocs.department-folders-update': { path: '/v1/enterprise/codocs/department-folders:update' },
  'codocs.department-folders-delete': { path: '/v1/enterprise/codocs/department-folders:delete' },
  'codocs.department-folders-open': { path: '/v1/enterprise/codocs/department-folders:open' },
  'codocs.department-cabinet-folders': { path: '/v1/enterprise/codocs/department-cabinet:folders' },
  'codocs.department-cabinet-list': { path: '/v1/enterprise/codocs/department-cabinet:list' },
  'codocs.department-cabinet-view': { path: '/v1/enterprise/codocs/department-cabinet:view' },
  'codocs.department-cabinet-converted-info': { path: '/v1/enterprise/codocs/department-cabinet:converted-info' },
  'codocs.department-cabinet-download': { path: '/v1/enterprise/codocs/department-cabinet:download' },
  'codocs.department-cabinet-upload-plan': { path: '/v1/enterprise/codocs/department-cabinet:upload-plan' },
  'codocs.department-cabinet-upload': { path: '/v1/enterprise/codocs/department-cabinet:upload' },
  'codocs.department-cabinet-update': { path: '/v1/enterprise/codocs/department-cabinet:update' },
  'codocs.department-cabinet-delete': { path: '/v1/enterprise/codocs/department-cabinet:delete' },
  'codocs.department-cabinet-folder-create': { path: '/v1/enterprise/codocs/department-cabinet:folder-create' },
  'codocs.department-cabinet-folder-update': { path: '/v1/enterprise/codocs/department-cabinet:folder-update' },
  'codocs.department-cabinet-folder-delete': { path: '/v1/enterprise/codocs/department-cabinet:folder-delete' },
  'codocs.department-cabinet-conversion-plan': { path: '/v1/enterprise/codocs/department-cabinet:conversion-plan' },
  'codocs.department-cabinet-convert': { path: '/v1/enterprise/codocs/department-cabinet:convert' },
  'codocs.department-cabinet-publish-record': { path: '/v1/enterprise/codocs/department-cabinet:publish-record' },
  'codocs.department-shares-list': { path: '/v1/enterprise/codocs/department-shares:list' },
  'codocs.department-shares-decide': { path: '/v1/enterprise/codocs/department-shares:decide' },
  'codocs.company-asset-record-access': { path: '/v1/enterprise/codocs/company-assets:record-access' },
  'codocs.company-asset-access-records': { path: '/v1/enterprise/codocs/company-assets:access-records' },
  'codocs.company-asset-export-access-records': { path: '/v1/enterprise/codocs/company-assets:export-access-records' },
  'codocs.company-asset-quick-publish-source': { path: '/v1/enterprise/codocs/company-assets:quick-publish-source' },
  'codocs.company-asset-quick-publish-prepare': { path: '/v1/enterprise/codocs/company-assets:quick-publish-prepare' },
  'codocs.company-asset-quick-publish-complete': { path: '/v1/enterprise/codocs/company-assets:quick-publish-complete' },
  'codocs.company-asset-mkdir-prepare': { path: '/v1/enterprise/codocs/company-assets:mkdir-prepare' },
  'codocs.company-asset-mkdir-complete': { path: '/v1/enterprise/codocs/company-assets:mkdir-complete' },
  'codocs.company-asset-delete-directory-prepare': { path: '/v1/enterprise/codocs/company-assets:delete-directory-prepare' },
  'codocs.company-asset-delete-directory-complete': { path: '/v1/enterprise/codocs/company-assets:delete-directory-complete' },
  'codocs.company-asset-move-prepare': { path: '/v1/enterprise/codocs/company-assets:move-prepare' },
  'codocs.company-asset-move-complete': { path: '/v1/enterprise/codocs/company-assets:move-complete' },
  'codocs.company-asset-archive-prepare': { path: '/v1/enterprise/codocs/company-assets:archive-prepare' },
  'codocs.company-asset-archive-complete': { path: '/v1/enterprise/codocs/company-assets:archive-complete' },
  'codocs.open-department-documents-list': { path: '/v1/enterprise/codocs/open-department-documents:list' },
  'codocs.open-department-documents-view': { path: '/v1/enterprise/codocs/open-department-documents:view' },
  'codocs.published-asset-links-create': { path: '/v1/enterprise/codocs/published-asset-links:create' },
  'codocs.published-asset-links-resolve': { path: '/v1/enterprise/codocs/published-asset-links:resolve' },
  'codocs.personal-cabinet-upload-plan': { path: '/v1/enterprise/codocs/personal-cabinet:upload-plan' },
  'codocs.personal-cabinet-upload': { path: '/v1/enterprise/codocs/personal-cabinet:upload' },
  'codocs.personal-cabinet-conversion-plan': { path: '/v1/enterprise/codocs/personal-cabinet:conversion-plan' },
  'codocs.personal-cabinet-convert': { path: '/v1/enterprise/codocs/personal-cabinet:convert' },
  'codocs.personal-cabinet-delete': { path: '/v1/enterprise/codocs/personal-cabinet:delete' },
  'codocs.personal-cabinet-view': { path: '/v1/enterprise/codocs/personal-cabinet:view' },
  'codocs.personal-cabinet-download': { path: '/v1/enterprise/codocs/personal-cabinet:download' },
  'codocs.personal-cabinet-converted-info': { path: '/v1/enterprise/codocs/personal-cabinet:converted-info' },
  'codocs.personal-document-recycle': { path: '/v1/enterprise/codocs/personal-documents:recycle' },
  'codocs.personal-document-restore-plan': { path: '/v1/enterprise/codocs/personal-documents:restore-plan' },
  'codocs.personal-document-restore': { path: '/v1/enterprise/codocs/personal-documents:restore' },
  'codocs.personal-document-check-name': { path: '/v1/enterprise/codocs/personal-documents:check-name' },
  'codocs.personal-document-create': { path: '/v1/enterprise/codocs/personal-documents:create' },
  'codocs.document-access-record': { path: '/v1/enterprise/codocs/document-access-records:record' },
  'codocs.personal-document-list': { path: '/v1/enterprise/codocs/personal-documents:list' },
  'codocs.personal-document-edit-metadata': { path: '/v1/enterprise/codocs/personal-documents:edit-metadata' },
  'codocs.personal-document-update': { path: '/v1/enterprise/codocs/personal-documents:update' },
  'codocs.personal-document-update-plan': { path: '/v1/enterprise/codocs/personal-documents:update-plan' },
  'codocs.document-transfer-department': { path: '/v1/enterprise/codocs/document-transfer:department' },
  'codocs.document-transfer-project': { path: '/v1/enterprise/codocs/document-transfer:project' },
  'codocs.personal-document-view': { path: '/v1/enterprise/codocs/personal-documents:view' },
  'codocs.personal-document-download': { path: '/v1/enterprise/codocs/personal-documents:download' },
  'codocs.personal-document-trash': { path: '/v1/enterprise/codocs/personal-documents:trash' },
  'codocs.personal-document-versions-list': { path: '/v1/enterprise/codocs/personal-documents:versions' },
  'codocs.personal-document-version-view': { path: '/v1/enterprise/codocs/personal-documents:version-view' },
  'codocs.personal-document-version-delete': { path: '/v1/enterprise/codocs/personal-documents:version-delete' },
  // v2 snapshots: registered in Runtime only when apps.codocs.snapshotV2Enabled.
  'codocs.personal-document-snapshot-prepare': { path: '/v1/enterprise/codocs/personal-documents:snapshot-prepare' },
  'codocs.personal-document-snapshot-publish': { path: '/v1/enterprise/codocs/personal-documents:snapshot-publish' },
  'codocs.personal-document-snapshot-read': { path: '/v1/enterprise/codocs/personal-documents:snapshot-read' },
  // Stage B: registered in Runtime only with apps.codocs.collaborationV2Enabled.
  'codocs.personal-document-collaboration-open': { path: '/v1/enterprise/codocs/personal-documents:collaboration-open' },
  // Department document collaboration: registered in Runtime only when snapshotV2, collaborationV2 and
  // departmentCollaborationV2 are all enabled. Same codocs:enterprise-host:execute capability; no new grant.
  'codocs.department-documents-collaboration-open': { path: '/v1/enterprise/codocs/department-documents:collaboration-open' },
  'codocs.department-documents-snapshot-read': { path: '/v1/enterprise/codocs/department-documents:snapshot-read' },
  'codocs.department-documents-snapshot-prepare': { path: '/v1/enterprise/codocs/department-documents:snapshot-prepare' },
  'codocs.department-documents-snapshot-publish': { path: '/v1/enterprise/codocs/department-documents:snapshot-publish' },
  // Read-only version history of a department document, registered with the same three switches.
  'codocs.department-documents-versions': { path: '/v1/enterprise/codocs/department-documents:versions' },
  'codocs.department-documents-version-view': { path: '/v1/enterprise/codocs/department-documents:version-view' },
  'codocs.personal-folder-list': { path: '/v1/enterprise/codocs/personal-documents:folders' },
  'codocs.personal-folder-view': { path: '/v1/enterprise/codocs/personal-folders:view' },
  'codocs.personal-folder-create': { path: '/v1/enterprise/codocs/personal-folders:create' },
  'codocs.personal-folder-update': { path: '/v1/enterprise/codocs/personal-folders:update' },
  'codocs.personal-folder-delete': { path: '/v1/enterprise/codocs/personal-folders:delete' },
  'altoc.customer-list': { path: '/v1/enterprise/altoc/customers:list' },
  'altoc.customer-view': { path: '/v1/enterprise/altoc/customers:view' },
  'altoc.contract-list': { path: '/v1/enterprise/altoc/contracts:list' },
  'altoc.contract-view': { path: '/v1/enterprise/altoc/contracts:view' },
  'altoc.receivable-list': { path: '/v1/enterprise/altoc/receivable-plans:list' },
  'altoc.receivable-view': { path: '/v1/enterprise/altoc/receivable-plans:view' },
  'altoc.lead-list': { path: '/v1/enterprise/altoc/leads:list' },
  'altoc.lead-view': { path: '/v1/enterprise/altoc/leads:view' },
  'altoc.opportunity-list': { path: '/v1/enterprise/altoc/opportunities:list' },
  'altoc.opportunity-view': { path: '/v1/enterprise/altoc/opportunities:view' },
  'altoc.quotation-list': { path: '/v1/enterprise/altoc/quotations:list' },
  'altoc.quotation-view': { path: '/v1/enterprise/altoc/quotations:view' },
  'altoc.contracts-activate-delivery': { path: '/v1/enterprise/altoc/contracts:activate-delivery' },
  'assets.product-categories-admin': { path: '/v1/enterprise/assets/product-categories:admin-list' },
  'assets.product-categories-save': { path: '/v1/enterprise/assets/product-categories:save' },
  'assets.products-link-base': { path: '/v1/enterprise/assets/products:link-base' },
  'assets.products-link-asset': { path: '/v1/enterprise/assets/products:link-asset' },
  'assets.products-link-document': { path: '/v1/enterprise/assets/products:link-document' },
  'assets.products-base-candidates': { path: '/v1/enterprise/assets/products:base-candidates' },
  'assets.products-asset-candidates': { path: '/v1/enterprise/assets/products:asset-candidates' },
  'assets.products-create': { path: '/v1/enterprise/assets/products:create' },
  'assets.products-edit': { path: '/v1/enterprise/assets/products:edit' },
  'assets.products-list': { path: '/v1/enterprise/assets/products:list' },
  'assets.products-view': { path: '/v1/enterprise/assets/products:view' },
  'assets.product-dictionaries': { path: '/v1/enterprise/assets/product-dictionaries:list' },
  'assets.product-categories': { path: '/v1/enterprise/assets/product-categories:list' },
  'assets.asset-dictionaries': { path: '/v1/enterprise/assets/dictionaries:list' },
  'assets.asset-items-list': { path: '/v1/enterprise/assets/assets:list' },
  'assets.asset-items-view': { path: '/v1/enterprise/assets/assets:view' },
  'assets.digital-assets-list': { path: '/v1/enterprise/assets/digital-assets:list' },
  'assets.digital-assets-view': { path: '/v1/enterprise/assets/digital-assets:view' },
  'assets.digital-assets-create': { path: '/v1/enterprise/assets/digital-assets:create' },
  'assets.digital-assets-edit': { path: '/v1/enterprise/assets/digital-assets:edit' },
  'assets.ip-assets-list': { path: '/v1/enterprise/assets/ip-assets:list' },
  'assets.ip-assets-view': { path: '/v1/enterprise/assets/ip-assets:view' },
  'assets.ip-assets-products': { path: '/v1/enterprise/assets/ip-assets:products' },
  'assets.ip-assets-create': { path: '/v1/enterprise/assets/ip-assets:create' },
  'assets.ip-assets-edit': { path: '/v1/enterprise/assets/ip-assets:edit' },
  'assets.ip-assets-link-product': { path: '/v1/enterprise/assets/ip-assets:link-product' },

  'aims.handoff-detail': { path: '/v1/enterprise/aims/handoff:detail' },
  'aims.handoff-projects': { path: '/v1/enterprise/aims/handoff:projects' },
  'aims.handoff-requirements': { path: '/v1/enterprise/aims/handoff:requirements' },
  'aims.handoff-project-authorization': { path: '/v1/enterprise/aims/handoff:project-authorization' },
  'aims.handoff-create': { path: '/v1/enterprise/aims/handoff:create' },

  'aims.version-execution-coordination': { path: '/v1/enterprise/aims/product-version:execution-coordination' },
  'aims.version-scope-list': { path: '/v1/enterprise/aims/product-version:scope-list' },
  'aims.version-scope-history': { path: '/v1/enterprise/aims/product-version:scope-history' },
  'aims.version-scope-deliver': { path: '/v1/enterprise/aims/product-version:scope-deliver' },
  'aims.version-scope-reopen': { path: '/v1/enterprise/aims/product-version:scope-reopen' },
  'aims.version-scope-edit': { path: '/v1/enterprise/aims/product-version:scope-edit' },
  'aims.version-scope-visibility': { path: '/v1/enterprise/aims/product-version:scope-visibility' },
  'aims.version-scope-legacy-criteria': { path: '/v1/enterprise/aims/product-version:scope-legacy-criteria' },
  'aims.version-acceptance-list': { path: '/v1/enterprise/aims/product-version:acceptance-list' },
  'aims.version-acceptance-view': { path: '/v1/enterprise/aims/product-version:acceptance-view' },
  'aims.version-release-list': { path: '/v1/enterprise/aims/product-version:release-list' },
  'aims.version-release-view': { path: '/v1/enterprise/aims/product-version:release-view' },

  'aims.feature-cycles': { path: '/v1/enterprise/aims/features:cycles' },
  'aims.feature-list': { path: '/v1/enterprise/aims/features:list' },
  'aims.feature-view': { path: '/v1/enterprise/aims/features:view' },
  'aims.feature-create': { path: '/v1/enterprise/aims/features:create' },
  'aims.feature-edit': { path: '/v1/enterprise/aims/features:edit' },
  'aims.feature-delete': { path: '/v1/enterprise/aims/features:delete' },
  'aims.feature-component-assign': { path: '/v1/enterprise/aims/features:component-assign' },
  'aims.feature-lifecycle': { path: '/v1/enterprise/aims/features:lifecycle' },
  'aims.feature-request-list': { path: '/v1/enterprise/aims/features:request-list' },
  'aims.feature-request-link': { path: '/v1/enterprise/aims/features:request-link' },
  'aims.feature-roadmap': { path: '/v1/enterprise/aims/features:roadmap' },
  'aims.feature-unscheduled': { path: '/v1/enterprise/aims/features:unscheduled' },

  'aims.component-create': { path: '/v1/enterprise/aims/components:create' },
  'aims.component-edit': { path: '/v1/enterprise/aims/components:edit' },
  'aims.component-move': { path: '/v1/enterprise/aims/components:move' },
  'aims.component-delete': { path: '/v1/enterprise/aims/components:delete' },
  'aims.onboard-candidates': { path: '/v1/enterprise/aims/product-onboard:candidates' },
  'aims.onboard-candidate': { path: '/v1/enterprise/aims/product-onboard:candidate' },
  'aims.onboard-line-candidates': { path: '/v1/enterprise/aims/product-line-onboard:candidates' },
  'aims.product-onboard': { path: '/v1/enterprise/aims/product-onboard' },
  'aims.product-line-onboard': { path: '/v1/enterprise/aims/product-line-onboard' },
  'aims.request-merge': { path: '/v1/enterprise/aims/product-requests:merge' },
  'aims.request-edit': { path: '/v1/enterprise/aims/product-requests:edit' },
  'aims.request-decide': { path: '/v1/enterprise/aims/product-requests:decide' },
  'aims.request-source-list': { path: '/v1/enterprise/aims/request-sources:list' },
  'aims.request-source-create': { path: '/v1/enterprise/aims/request-sources:create' },
  'aims.request-source-delete': { path: '/v1/enterprise/aims/request-sources:delete' },

  'aims.product-workspace-view': { path: '/v1/enterprise/aims/product-workspace:view' },
  // Project management is deliberately registered separately from the product
  // workspace.  The Host never forwards an arbitrary Aims path to Runtime.
  'aims.project-list': { path: '/v1/enterprise/aims/projects:list' },
  'aims.project-view': { path: '/v1/enterprise/aims/projects:view' },
  'aims.project-create': { path: '/v1/enterprise/aims/projects:create' },
  'aims.project-edit': { path: '/v1/enterprise/aims/projects:update' },
  'aims.project-modules-update': { path: '/v1/enterprise/aims/project-modules:update' },
  'aims.project-lifecycle-request': { path: '/v1/enterprise/aims/project-lifecycle:request' },
  'aims.project-lifecycle-bind': { path: '/v1/enterprise/aims/project-lifecycle:bind' },
  'aims.admin-project-list': { path: '/v1/enterprise/aims/admin-projects:list' },
  'aims.admin-project-update': { path: '/v1/enterprise/aims/admin-projects:update' },
  'aims.project-member-add': { path: '/v1/enterprise/aims/project-members:add' },
  'aims.project-member-role': { path: '/v1/enterprise/aims/project-members:role' },
  'aims.project-member-remove': { path: '/v1/enterprise/aims/project-members:remove' },
  'aims.work-item-create': { path: '/v1/enterprise/aims/work-items:create' },
  'aims.work-item-edit': { path: '/v1/enterprise/aims/work-items:edit' },
  'aims.work-item-delete': { path: '/v1/enterprise/aims/work-items:delete' },
  'aims.work-item-associate': { path: '/v1/enterprise/aims/work-items:associate' },
  'aims.work-item-complete': { path: '/v1/enterprise/aims/work-items:complete' },
  'aims.work-item-matter-complete': { path: '/v1/enterprise/aims/work-items:matter-complete' },
  'aims.work-item-plan-ready': { path: '/v1/enterprise/aims/work-items:plan-ready' },
  'aims.work-item-start': { path: '/v1/enterprise/aims/work-items:start' },
  'aims.work-item-reset': { path: '/v1/enterprise/aims/work-items:reset' },
  'aims.work-item-reopen': { path: '/v1/enterprise/aims/work-items:reopen' },
  'aims.work-item-confirm-distribute': { path: '/v1/enterprise/aims/work-items:confirm-distribute' },
  'aims.work-item-revoke-distribute': { path: '/v1/enterprise/aims/work-items:revoke-distribute' },
  'aims.work-item-confirm-append': { path: '/v1/enterprise/aims/work-items:confirm-append' },
  'aims.work-item-reject-append': { path: '/v1/enterprise/aims/work-items:reject-append' },
  'aims.work-item-append-tasks': { path: '/v1/enterprise/aims/work-items:append-tasks' },
  'aims.work-item-breakdown': { path: '/v1/enterprise/aims/work-items:breakdown' },
  'aims.work-item-completion-replay': { path: '/v1/enterprise/aims/work-items:completion-replay' },
  'aims.work-item-list': { path: '/v1/enterprise/aims/work-items:list' },
  'aims.work-item-view': { path: '/v1/enterprise/aims/work-items:view' },
  'aims.work-item-breakdown-context': { path: '/v1/enterprise/aims/work-items:breakdown-context' },
  'aims.time-entry-list': { path: '/v1/enterprise/aims/time-entries:list' },
  'aims.time-entry-view': { path: '/v1/enterprise/aims/time-entries:view' },
  'aims.weekly-report-list': { path: '/v1/enterprise/aims/weekly-reports:list' },
  'aims.weekly-report-view': { path: '/v1/enterprise/aims/weekly-reports:view' },
  'aims.project-member-list': { path: '/v1/enterprise/aims/project-members:list' },
  'aims.project-requirement-list': { path: '/v1/enterprise/aims/project-requirements:list' },
  'aims.project-requirement-view': { path: '/v1/enterprise/aims/project-requirements:view' },
  'aims.project-requirement-target-list': { path: '/v1/enterprise/aims/project-requirements:targets' },
  'aims.project-requirement-spec-view': { path: '/v1/enterprise/aims/project-requirements:spec' },
  'aims.project-requirement-create': { path: '/v1/enterprise/aims/project-requirements:create' },
  'aims.project-requirement-content-create': { path: '/v1/enterprise/aims/project-requirements:content-create' },
  'aims.project-requirement-import': { path: '/v1/enterprise/aims/project-requirements:import' },
  'aims.project-requirement-update': { path: '/v1/enterprise/aims/project-requirements:update' },
  'aims.project-requirement-delete': { path: '/v1/enterprise/aims/project-requirements:delete' },
  'aims.project-requirement-content-update': { path: '/v1/enterprise/aims/project-requirements:content-update' },
  'aims.project-requirement-content-delete': { path: '/v1/enterprise/aims/project-requirements:content-delete' },
  'aims.project-requirement-content-restore': { path: '/v1/enterprise/aims/project-requirements:content-restore' },
  'aims.project-requirement-versions': { path: '/v1/enterprise/aims/project-requirements:versions' },
  'aims.project-requirement-change-diff': { path: '/v1/enterprise/aims/project-requirements:change-diff' },
  'aims.project-requirement-change-impact': { path: '/v1/enterprise/aims/project-requirements:change-impact' },
  'aims.project-requirement-review-list': { path: '/v1/enterprise/aims/project-requirements:review-list' },
  'aims.project-requirement-review-resolve': { path: '/v1/enterprise/aims/project-requirements:review-resolve' },
  'aims.project-requirement-change-create': { path: '/v1/enterprise/aims/project-requirements:change-create' },
  'aims.project-requirement-task-create': { path: '/v1/enterprise/aims/project-requirements:task-create' },
  'aims.project-requirement-review-create': { path: '/v1/enterprise/aims/project-requirements:review-create' },
  'aims.project-requirement-review-append': { path: '/v1/enterprise/aims/project-requirements:review-append' },
  'aims.project-requirement-review-sync': { path: '/v1/enterprise/aims/project-requirements:review-sync' },
  'aims.project-requirement-review-create-tasks': { path: '/v1/enterprise/aims/project-requirements:review-create-tasks' },
  'aims.project-requirement-review-withdraw': { path: '/v1/enterprise/aims/project-requirements:review-withdraw' },

  'aims.project-plan-milestones': { path: '/v1/enterprise/aims/project-plan:milestones' },
  'aims.project-plan-items': { path: '/v1/enterprise/aims/project-plan:items' },
  'aims.project-board-view': { path: '/v1/enterprise/aims/project-board:view' },
  'aims.timesheet-overview': { path: '/v1/enterprise/aims/timesheet-overview:view' },
  'aims.weekly-report-overview': { path: '/v1/enterprise/aims/weekly-report-overview:view' },
  'aims.component-list': { path: '/v1/enterprise/aims/components:list' },
  'aims.version-plan': { path: '/v1/enterprise/aims/versions:plan' },
  'aims.version-plan-items': { path: '/v1/enterprise/aims/versions:plan-items' },
  'aims.version-list': { path: '/v1/enterprise/aims/versions:list' },
  'aims.version-view': { path: '/v1/enterprise/aims/versions:view' },
  'aims.product-list': { path: '/v1/enterprise/aims/product-list' },
  'aims.version-accept': { path: '/v1/enterprise/aims/product-version:accept' },
  'aims.version-publish': { path: '/v1/enterprise/aims/product-version:publish' },
  'aims.version-acceptance-preview': { path: '/v1/enterprise/aims/product-version:acceptance-preview' },
  'aims.version-execution-project-authorization': { path: '/v1/enterprise/aims/product-version:execution-project-authorization' },
  'aims.version-edit': { path: '/v1/enterprise/aims/product-version:edit' },
  'aims.version-delete': { path: '/v1/enterprise/aims/product-version:delete' },
  'aims.version-transition': { path: '/v1/enterprise/aims/product-version:transition' },
  'aims.version-reopen': { path: '/v1/enterprise/aims/product-version:reopen' },
  'aims.version-archive': { path: '/v1/enterprise/aims/product-version:archive' },
  'aims.version-create': { path: '/v1/enterprise/aims/versions:create' },
  'aims.version-plan-edit': { path: '/v1/enterprise/aims/versions:plan-edit' },
  'aims.version-plan-item-create': { path: '/v1/enterprise/aims/versions:plan-item-create' },
  'aims.version-plan-item-edit': { path: '/v1/enterprise/aims/versions:plan-item-edit' },
  'aims.version-plan-item-delete': { path: '/v1/enterprise/aims/versions:plan-item-delete' },
  'aims.version-plan-confirm': { path: '/v1/enterprise/aims/versions:plan-confirm' },
  'aims.product-request-list': { path: '/v1/enterprise/aims/product-requests:list' },
  'aims.product-request-view': { path: '/v1/enterprise/aims/product-requests:view' },
  'aims.product-document-list': { path: '/v1/enterprise/aims/product-documents:list' },
  'aims.product-document-requests': { path: '/v1/enterprise/aims/product-documents:requests' },
  'aims.product-document-search': { path: '/v1/enterprise/aims/product-documents:search' },
  'aims.product-document-content': { path: '/v1/enterprise/aims/product-documents:content' },
  'aims.product-document-link': { path: '/v1/enterprise/aims/product-documents:link' },
  'aims.project-document-department-source': { path: '/v1/enterprise/aims/project-documents:department-source' },
  'aims.project-document-context': { path: '/v1/enterprise/aims/project-documents:context' },
  'aims.project-document-owner': { path: '/v1/enterprise/aims/project-documents:owner' },
  'aims.project-document-create': { path: '/v1/enterprise/aims/project-documents:create' },
  'aims.project-document-summary': { path: '/v1/enterprise/aims/project-documents:summary' },
  'aims.project-document-delete': { path: '/v1/enterprise/aims/project-documents:delete' },
  'aims.project-document-list': { path: '/v1/enterprise/aims/project-documents:list' },
  'aims.project-document-view': { path: '/v1/enterprise/aims/project-documents:view' },
  'aims.project-document-accessible-list': { path: '/v1/enterprise/aims/project-documents:accessible' },
  'aims.project-products-list': { path: '/v1/enterprise/aims/project-products:list' },
  'aims.project-products-link': { path: '/v1/enterprise/aims/project-products:link' },
  'aims.product-authorization': { path: '/v1/enterprise/aims/product-authorization' },
  'aims.product-request-create': { path: '/v1/enterprise/aims/product-requests:create' },
  'assets.product-directory': { path: '/v1/enterprise/assets/product-directory' },
  'assets.product-directory-resolve': { path: '/v1/enterprise/assets/product-directory:resolve' },
  // 工作项细化与执行（第一批）：全部委托给既有 Aims handler，capability 按子资源拆分。
  'aims.work-item-comment-list': { path: '/v1/enterprise/aims/work-item-comments:view' },
  'aims.work-item-comment-create': { path: '/v1/enterprise/aims/work-item-comments:create' },
  'aims.work-item-commit-list': { path: '/v1/enterprise/aims/work-item-commits:view' },
  'aims.work-item-commit-link': { path: '/v1/enterprise/aims/work-item-commits:link' },
  'aims.work-item-commit-unlink': { path: '/v1/enterprise/aims/work-item-commits:unlink' },
  'aims.work-item-document-list': { path: '/v1/enterprise/aims/work-item-documents:view' },
  'aims.work-item-document-link': { path: '/v1/enterprise/aims/work-item-documents:link' },
  'aims.work-item-document-unlink': { path: '/v1/enterprise/aims/work-item-documents:unlink' },
  'aims.work-item-document-unlink-current': { path: '/v1/enterprise/aims/work-item-documents:unlink-current' },
  'aims.work-item-time-entry-list': { path: '/v1/enterprise/aims/work-item-time-entries:view' },
  'aims.work-item-time-entry-create': { path: '/v1/enterprise/aims/work-item-time-entries:create' },
  'aims.work-item-time-entry-update': { path: '/v1/enterprise/aims/work-item-time-entries:update' },
  'aims.work-item-time-entry-delete': { path: '/v1/enterprise/aims/work-item-time-entries:delete' },
  'aims.work-item-transitions': { path: '/v1/enterprise/aims/work-item-execution:transitions' },
  'aims.work-item-execution-context': { path: '/v1/enterprise/aims/work-item-execution:context' },
  'aims.work-item-source-sections': { path: '/v1/enterprise/aims/work-item-execution:source-sections' },
  'aims.work-item-decompose-context': { path: '/v1/enterprise/aims/work-item-execution:decompose-context' },
  'aims.work-item-children': { path: '/v1/enterprise/aims/work-item-execution:children' },
  'aims.work-item-decompose-submit': { path: '/v1/enterprise/aims/work-item-decomposition:submit' },
  'aims.work-item-clone-from-template': { path: '/v1/enterprise/aims/work-item-decomposition:clone-from-template' },
  'aims.work-item-deliverable-update': { path: '/v1/enterprise/aims/work-item-deliverables:update' },
  'aims.work-item-batch-update': { path: '/v1/enterprise/aims/work-item-batch:update' },
  // 项目线共享依赖（第 0 批）：useProjectStore 与 ProjectNavbar 的前提。
  'aims.project-favorite-list': { path: '/v1/enterprise/aims/project-favorites:view' },
  'aims.project-favorite-add': { path: '/v1/enterprise/aims/project-favorites:add' },
  'aims.project-favorite-remove': { path: '/v1/enterprise/aims/project-favorites:remove' },
  'aims.quality-submission-resume': { path: '/v1/enterprise/aims/deliverable-quality:submission-resume' },
  'aims.quality-submission-create': { path: '/v1/enterprise/aims/deliverable-quality:submission-create' },
  'aims.quality-submission-activate': { path: '/v1/enterprise/aims/deliverable-quality:submission-activate' },
  'aims.quality-completeness': { path: '/v1/enterprise/aims/deliverable-quality:completeness' },
  'aims.quality-waiver': { path: '/v1/enterprise/aims/deliverable-quality:waiver' },
  'aims.project-output-overview': { path: '/v1/enterprise/aims/project-output:view' },
  'aims.project-repo-candidates': { path: '/v1/enterprise/aims/project-repos:candidates' },
  'aims.project-repo-list': { path: '/v1/enterprise/aims/project-repos:view' },
  'aims.project-repo-link': { path: '/v1/enterprise/aims/project-repos:link' },
  'aims.project-repo-unlink': { path: '/v1/enterprise/aims/project-repos:unlink' },
  'aims.project-work-item-list': { path: '/v1/enterprise/aims/project-work-items:list' },
  // 交付物与项目版本（第 2 批）：项目工作项页的剩余依赖。
  'aims.project-deliverable-list': { path: '/v1/enterprise/aims/project-deliverables:list' },
  'aims.project-deliverable-update': { path: '/v1/enterprise/aims/project-deliverables:update' },
  'aims.project-deliverable-delete': { path: '/v1/enterprise/aims/project-deliverables:delete' },
  'aims.project-deliverable-batch-create': { path: '/v1/enterprise/aims/project-deliverables:batch-create' },
  'aims.project-release-list': { path: '/v1/enterprise/aims/project-releases:list' },
  // 里程碑：useMilestoneStore 的读写，项目工作项页的传递依赖。
  'aims.project-milestone-list': { path: '/v1/enterprise/aims/project-milestones:list' },
  'aims.project-milestone-create': { path: '/v1/enterprise/aims/project-milestones:create' },
  'aims.project-milestone-update': { path: '/v1/enterprise/aims/project-milestones:update' },
  'aims.project-milestone-delete': { path: '/v1/enterprise/aims/project-milestones:delete' },
  'aims.project-routine-review': { path: '/v1/enterprise/aims/project-routine-review:view' },
  // 项目集与项目删除：项目列表页依赖。删除是破坏性动作，单独 capability。
  'aims.project-portfolio-list': { path: '/v1/enterprise/aims/project-portfolios:list' },
  'aims.project-portfolio-create': { path: '/v1/enterprise/aims/project-portfolios:create' },
  'aims.project-portfolio-update': { path: '/v1/enterprise/aims/project-portfolios:update' },
  'aims.project-portfolio-delete': { path: '/v1/enterprise/aims/project-portfolios:delete' },
  'aims.project-delete': { path: '/v1/enterprise/aims/project-deletion:execute' },
  // 工时与任务中心：全局任务中心、项目工时、全局工时三页的依赖。
  'aims.my-work-item-list': { path: '/v1/enterprise/aims/my-work-items:list' },
  'aims.time-entry-review-list': { path: '/v1/enterprise/aims/time-entry-reviews:list' },
  'aims.time-entry-review-submit': { path: '/v1/enterprise/aims/time-entry-reviews:submit' },
  'aims.user-time-entry-list': { path: '/v1/enterprise/aims/user-time-entries:list' },
  'aims.project-time-entry-create': { path: '/v1/enterprise/aims/project-time-entries:create' },
  'aims.project-time-entry-update': { path: '/v1/enterprise/aims/project-time-entries:update' },
  'aims.project-time-entry-delete': { path: '/v1/enterprise/aims/project-time-entries:delete' },
  'aims.timesheet-week-submit': { path: '/v1/enterprise/aims/timesheet-weeks:submit' },
  // 全局周报页：公司周报汇总、周期治理、周报审阅。
  'aims.company-weekly-summary-view': { path: '/v1/enterprise/aims/company-weekly-summaries:view' },
  'aims.company-weekly-summary-versions': { path: '/v1/enterprise/aims/company-weekly-summaries:versions' },
  'aims.company-weekly-summary-save-draft': { path: '/v1/enterprise/aims/company-weekly-summaries:save-draft' },
  'aims.company-weekly-summary-generate': { path: '/v1/enterprise/aims/company-weekly-summaries:generate' },
  'aims.company-weekly-summary-publish': { path: '/v1/enterprise/aims/company-weekly-summaries:publish' },
  'aims.company-weekly-summary-cancel-publish': { path: '/v1/enterprise/aims/company-weekly-summaries:cancel-publish' },
  'aims.company-weekly-summary-open-correction': { path: '/v1/enterprise/aims/company-weekly-summaries:open-correction' },
  'aims.company-weekly-summary-retry': { path: '/v1/enterprise/aims/company-weekly-summaries:retry' },
  'aims.weekly-reporting-period-workbench': { path: '/v1/enterprise/aims/weekly-reporting-periods:director-workbench' },
  'aims.weekly-reporting-period-generate': { path: '/v1/enterprise/aims/weekly-reporting-periods:generate' },
  'aims.weekly-reporting-settings-view': { path: '/v1/enterprise/aims/weekly-reporting-settings:view' },
  'aims.weekly-reporting-settings-update': { path: '/v1/enterprise/aims/weekly-reporting-settings:update' },
  'aims.weekly-report-review': { path: '/v1/enterprise/aims/weekly-report-review:review' },
  'aims.weekly-report-open-correction': { path: '/v1/enterprise/aims/weekly-report-review:open-correction' },
  // 项目计划页：模板版本、里程碑周期开启、需求目标。
  'aims.project-template-version-list': { path: '/v1/enterprise/aims/project-template-versions:list' },
  'aims.project-template-version-view': { path: '/v1/enterprise/aims/project-template-versions:view' },
  'aims.milestone-rollover': { path: '/v1/enterprise/aims/milestone-rollover:execute' },
  'aims.requirement-target-create': { path: '/v1/enterprise/aims/requirement-targets:create' },
  // 工作项执行页的 GitLab 依赖；diff 内容由宿主直连 GitLab，Runtime 只给元数据与写回。
  'aims.project-gitlab-commits': { path: '/v1/enterprise/aims/project-gitlab:commits' },
  'aims.project-gitlab-sync-context': { path: '/v1/enterprise/aims/project-gitlab:sync-context' },
  'aims.project-gitlab-commit-ingest': { path: '/v1/enterprise/aims/project-gitlab:commit-ingest' },
  'aims.work-item-commit-diff-metadata': { path: '/v1/enterprise/aims/work-item-commit-diff:metadata' },
  'aims.work-item-commit-files-changed': { path: '/v1/enterprise/aims/work-item-commit-diff:files-changed' },
  'aims.project-weekly-report-save-draft': { path: '/v1/enterprise/aims/project-weekly-report-period:save-draft' },
  'aims.project-weekly-report-submit': { path: '/v1/enterprise/aims/project-weekly-report-period:submit' },
  'assets.product-adoption-read': { path: '/v1/enterprise/assets/product-adoption:read' }
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

export function enterpriseHostDomainCapabilityForPath(path: string) {
  const match = /^\/v1\/enterprise\/(aims|assets|codocs|altoc|console)\/[^/?#]+$/.exec(path)
  if (!match) throw createError({ statusCode: 503, message: 'Enterprise operation path is not registered.' })
  return `${match[1]}:enterprise-host:execute`
}

function enterpriseRuntimeCallOptions(route: { path: string }) {
  return {
    appCode: 'enterprise', scope: enterpriseHostDomainCapabilityForPath(route.path), capabilityFormat: 'business' as const,
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
  }).catch((error: unknown) => {
    throw enterpriseRuntimeBrowserError(error)
  })
  if (!response.handled) throw createError({ statusCode: 503, message: 'Enterprise runtime is unavailable.' })
  return response.data
}

/**
 * Browser-facing shape of a failed Runtime call: keep the HTTP status and the
 * stable machine code from the Runtime contract, replace the message with a
 * fixed per-status text. Runtime messages may carry dynamic diagnostics and
 * transport failures carry the internal Runtime URL; neither leaves the Host.
 */
export function enterpriseRuntimeBrowserError(error: unknown) {
  const failure = (error || {}) as { statusCode?: unknown, data?: { code?: unknown, upstreamStatus?: unknown } }
  const statusCode = Number(failure.statusCode)
  if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) return error
  const code = safeEnterpriseErrorCode(failure.data?.code)
  const upstreamStatus = Number(failure.data?.upstreamStatus)
  const message = enterpriseErrorMessage(statusCode)
  return createError({
    statusCode,
    message,
    data: {
      ...(code ? { code } : {}),
      message,
      ...(Number.isInteger(upstreamStatus) && upstreamStatus >= 400 && upstreamStatus <= 599 ? { upstreamStatus } : {})
    }
  })
}
