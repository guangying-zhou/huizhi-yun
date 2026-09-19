import { handleProductVersionScope } from '../utils/productVersionScopeRuntime'
import { handleProductCostRulesRead } from '../utils/productCostRulesRead'
import { handleProductCostRulesStatus } from '../utils/productCostRulesStatus'
import { handleProductCostRulesSave } from '../utils/productCostRulesSave'
import { handleProductFeedbackService } from '../utils/productFeedbackService'
import { handleEnterpriseProjectDocumentsService } from '../utils/enterpriseProjectDocumentsService'
import { handleEnterpriseProjectDocumentFilesService } from '../utils/enterpriseProjectDocumentFilesService'
import { handleEnterpriseProjectDocumentSourcesService } from '../utils/enterpriseProjectDocumentSourcesService'
import { handleEnterpriseProjectDocumentWritesService } from '../utils/enterpriseProjectDocumentWritesService'
import { handleEnterpriseProjectDocumentAccessService } from '../utils/enterpriseProjectDocumentAccessService'
import { handleEnterpriseAccessibleProjectDocumentsService } from '../utils/enterpriseAccessibleProjectDocumentsService'
import { createError, getRequestURL, type H3Event } from 'h3'
import { maybeProxyCurrentApiToTenantRuntime, type TenantRuntimeProxyContext } from '@hzy/foundation/server/utils/tenantRuntimeProxy'
import { resolveConsoleAuthWithSessionBridge } from '@hzy/foundation/server/utils/consoleSessionBridge'
import { checkPermission, requirePermission } from '~~/server/utils/checkPermission'
import { hasAimsAdminRoleAccess, hasAimsSystemManageAccess, requireAimsAdminRoleAccess, requireAimsProjectDeleteAccess, requireAimsProjectManageAccess } from '~~/server/utils/aimsAdminAccess'
import {
  checkAimsScopedPermission,
  resolveAimsProjectListAdminScopeQuery,
  resolveAimsProjectAuthorizationObject
} from '~~/server/utils/aimsScopedAuthorization'
import { callAimsRuntime, requireProjectDocumentDeleteAccess } from '~~/server/utils/projectDocumentAccess'
import {
  requireCurrentProjectGovernanceRoleHolder,
  resolveProjectGovernanceRoleHolder
} from '~~/server/utils/projectGovernanceRoleHolder'
import { fetchUserDepartments } from '~~/server/utils/userDepartments'
import { requireServiceScope } from '~~/server/utils/serviceAuth'
import { getRequestUid } from '~~/server/utils/authIdentity'

const APP_CODE = 'aims'
const API_PREFIX = '/api/v1'
const aimsProjectDeleteAccessVerifiedKey = Symbol('aims.projectDeleteAccessVerified')

type AimsProjectDeleteAccessEventContext = H3Event['context'] & {
  [aimsProjectDeleteAccessVerifiedKey]?: boolean
}
const RUNTIME_RESOURCES = [
  '/admin/weekly-reporting-settings',
  '/admin/projects',
  '/approvals',
  '/company-weekly-summaries',
  '/deliverables',
  '/documents',
  '/milestones',
  '/portfolios',
  '/project-template-versions',
  '/projects',
  '/weekly-reporting-periods',
  '/requirement-contents',
  '/requirement-reviews',
  '/requirements',
  '/work-items'
]
const RUNTIME_READONLY_COLLECTIONS = [
  '/my-board',
  '/my-work-items',
  '/weekly-reports',
  '/weekly-reports/export-data',
  '/workspace'
]
const RUNTIME_NESTED_RESOURCES = [
  /^\/projects\/[^/]+\/manager-delegations$/,
  /^\/projects\/[^/]+\/documents$/,
  /^\/projects\/[^/]+\/environments$/,
  /^\/projects\/[^/]+\/gitlab-commits$/,
  /^\/projects\/[^/]+\/members$/,
  /^\/projects\/[^/]+\/milestones$/,
  /^\/projects\/[^/]+\/repos$/,
  /^\/projects\/[^/]+\/requirement-contents$/,
  /^\/projects\/[^/]+\/requirement-reviews$/,
  /^\/projects\/[^/]+\/requirements$/,
  /^\/projects\/[^/]+\/time-entries$/,
  /^\/projects\/[^/]+\/weekly-reports$/,
  /^\/projects\/[^/]+\/work-items$/,
  /^\/users\/[^/]+\/time-entries$/,
  /^\/work-items\/[^/]+\/comments$/,
  /^\/work-items\/[^/]+\/documents$/,
  /^\/work-items\/[^/]+\/time-entries$/
]
const RUNTIME_NESTED_ITEM_RESOURCES = [
  /^\/projects\/[^/]+\/time-entries\/[^/]+$/,
  /^\/work-items\/[^/]+\/time-entries\/[^/]+$/
]
const DIRECT_PROJECT_SCOPED_ADMIN_OBJECT_PATTERN = /^\/(?:deliverables|documents|milestones|requirements|requirement-contents|requirement-reviews|work-items)\/[^/]+$/
const NUXT_ONLY_MARKERS = [
  '/service/work-item-completion/workflow-callback',
  '/check-duplicate',
  '/requirements/spec',
  '/requirements/import',
  '/requirements/export',
  '/requirements/codocs-candidates',
  '/requirements/create-task',
  '/requirement-targets',
  '/transition',
  '/submit',
  '/withdraw',
  '/approve',
  '/reject',
  '/sync-workflow',
  '/create-tasks',
  '/append-requirements',
  '/people-contributions/sync',
  '/review-approve',
  '/rollover',
  '/append-tasks',
  '/confirm-append',
  '/reject-append',
  '/confirm-distribute',
  '/revoke-distribute',
  '/decompose-submit',
  '/breakdown',
  '/approval-status',
  '/children',
  '/execution-context',
  '/breakdown-context',
  '/decompose-context',
  '/source-sections',
  '/markdown-documents',
  '/other-documents',
  '/project-documents/accessible',
  '/access-check',
  '/access-policy',
  '/access-audit',
  '/clone-from-template',
  '/commits'
]

const NUXT_ONLY_PATTERNS = [
  // Product-center BFF handlers compile scoped authorization before calling
  // their dedicated runtime commands; they must not use the generic proxy.
  /^\/api\/v1\/products(?:\/.*)?$/,
  /^\/api\/v1\/product-(?:permissions|candidates)$/,
  /^\/api\/v1\/admin\/projects\/batch-create-routine$/,
  /^\/api\/v1\/authorization\/instance-conflict-explain$/,
  /^\/api\/v1\/service\/notification-details\/authorize(?:\/finalize)?$/,
  /^\/api\/v1\/integration-operations(?:\/[^/]+\/(?:replay|attempts))?$/,
  /^\/api\/v1\/documents$/,
  /^\/api\/v1\/weekly-reports\/export$/,
  /^\/api\/v1\/project-documents\/accessible$/,
  /^\/api\/v1\/requirement-reviews\/[^/]+\/resolve$/,
  /^\/api\/v1\/product-assets$/,
  /^\/api\/v1\/work-items\/[^/]+$/,
  /^\/api\/v1\/projects\/[^/]+\/(markdown-documents|other-documents)$/,
  /^\/api\/v1\/projects\/[^/]+\/sync-gitlab-issues$/,
  /^\/api\/v1\/projects\/[^/]+\/environments\/upsert$/,
  /^\/api\/v1\/projects\/[^/]+\/environments\/[^/]+:status$/,
  /^\/api\/v1\/projects\/[^/]+\/documents\/[^/]+\/(access-check|access-policy|access-audit|download|preview)$/,
  /^\/api\/v1\/service\/products\/[^/]+\/versions$/,
  /^\/api\/v1\/service\/service-tickets\/[^/]+\/work-item\/receive$/,
  // 以下路径本地 handler 为 tenant-runtime 转发器（鉴权上下文 + 调用 runtime 专用端点）
  /^\/api\/v1\/requirements\/[^/]+\/create-task$/,
  /^\/api\/v1\/requirements\/[^/]+\/changes$/,
  /^\/api\/v1\/requirement-contents\/[^/]+\/restore$/,
  /^\/api\/v1\/projects\/[^/]+\/sync-gitlab$/,
  /^\/api\/v1\/deliverables\/[^/]+\/submissions$/,
  /^\/api\/v1\/quality-reviews\/[^/]+\/content$/,
  /^\/api\/v1\/milestones\/[^/]+\/completion-requests$/,
  /^\/api\/v1\/milestone-completion-requests\/[^/]+\/bind-workflow$/,
  /^\/api\/v1\/company-weekly-summaries\/[^/]+:(?:publish|retry)$/,
  /^\/api\/v1\/service\/workflow\/callback$/
]

const NUXT_ONLY_MARKER_ROUTE_PATTERNS = [
  /^\/api\/v1\/projects\/check-duplicate$/,
  /^\/api\/v1\/projects\/[^/]+\/requirements\/(?:spec|import|export|codocs-candidates)$/,
  /^\/api\/v1\/projects\/[^/]+\/requirement-targets$/,
  /^\/api\/v1\/project-template-versions\/[^/]+\/transition$/,
  /^\/api\/v1\/requirement-reviews\/[^/]+\/(?:append-requirements|approve|create-tasks|reject|sync-workflow|withdraw)$/,
  /^\/api\/v1\/projects\/[^/]+\/people-contributions\/sync$/,
  /^\/api\/v1\/milestones\/[^/]+\/review-approve$/,
  /^\/api\/v1\/projects\/[^/]+\/milestones\/[^/]+\/rollover$/,
  /^\/api\/v1\/work-items\/[^/]+\/(?:append-tasks|approval-status|breakdown|breakdown-context|children|clone-from-template|commits|confirm-append|confirm-distribute|decompose-context|decompose-submit|execution-context|reject-append|revoke-distribute|source-sections|submit|transitions|withdraw)$/,
  /^\/api\/v1\/work-items\/[^/]+\/commits\/[^/]+(?:\/diff)?$/
]

const NUXT_ONLY_GET_PATTERNS = [
  /^\/api\/v1\/admin\/products\/[^/]+\/versions$/,
  /^\/api\/v1\/projects\/[^/]+\/requirements$/,
  /^\/api\/v1\/projects\/[^/]+\/requirements\/spec$/,
  /^\/api\/v1\/projects\/[^/]+\/requirement-targets$/
]

const NUXT_ONLY_GET_SUFFIX_PATTERNS = [
  /^\/admin\/products\/[^/]+\/versions$/,
  /^\/projects\/[^/]+\/requirements$/,
  /^\/projects\/[^/]+\/requirements\/spec$/,
  /^\/projects\/[^/]+\/requirement-targets$/
]

interface RuntimeDeptNode {
  deptCode?: string
  children?: RuntimeDeptNode[]
}

interface RuntimeApprovalRecord {
  project_owner_id?: number | null
  projectOwnerId?: number | null
  milestone_owner_id?: number | null
  milestoneOwnerId?: number | null
  work_item_owner_id?: number | null
  workItemOwnerId?: number | null
  reviewer_uid?: string | null
  reviewerUid?: string | null
  status?: string | null
}

export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname
  if (isApiV1Path(pathname)) {
    await ensureConsoleAuthContext(event)
  }
  const scopeVisibilityPath = /^\/api\/v1\/products\/([^/]+)\/versions\/([1-9]\d*)\/features\/([1-9]\d*)\/visibility$/.exec(normalizedApiV1Path(pathname))
  if (scopeVisibilityPath) {
    if (event.method !== 'POST') throw createError({ statusCode: 405, message: 'POST required' })
    let productCode: string
    try {
      productCode = decodeURIComponent(scopeVisibilityPath[1]!)
    } catch {
      throw createError({ statusCode: 400, message: '产品标识无效' })
    }
    event.context.params = { ...event.context.params, productCode, versionId: scopeVisibilityPath[2]!, scopeId: scopeVisibilityPath[3]! }
    return await handleProductVersionScope(event, 'visibility')
  }
  const costRulesStatusPath = normalizedApiV1Path(pathname).match(/^\/api\/v1\/projects\/([1-9][0-9]*)\/product-cost-rules\/([^/]+)$/)
  if (costRulesStatusPath) return await handleProductCostRulesStatus(event, costRulesStatusPath[1]!, costRulesStatusPath[2]!)
  const costRulesPath = normalizedApiV1Path(pathname).match(/^\/api\/v1\/projects\/([1-9][0-9]*)\/product-cost-rules$/)
  if (costRulesPath) return event.method === 'GET'
    ? await handleProductCostRulesRead(event, costRulesPath[1]!)
    : await handleProductCostRulesSave(event, costRulesPath[1])
  if (pathname === '/api/v1/service/product-requests/from-feedback') return await handleProductFeedbackService(event)
  if (normalizedApiV1Path(pathname) === '/api/v1/service/enterprise/project-documents/read') return await handleEnterpriseProjectDocumentsService(event)
  if (normalizedApiV1Path(pathname) === '/api/v1/service/enterprise/project-document-files/read') return await handleEnterpriseProjectDocumentFilesService(event)
  if (normalizedApiV1Path(pathname) === '/api/v1/service/enterprise/project-document-sources/read') return await handleEnterpriseProjectDocumentSourcesService(event)
  if (normalizedApiV1Path(pathname) === '/api/v1/service/enterprise/project-document-writes/execute') return await handleEnterpriseProjectDocumentWritesService(event)
  if (normalizedApiV1Path(pathname) === '/api/v1/service/enterprise/project-document-access/execute') return await handleEnterpriseProjectDocumentAccessService(event)
  if (normalizedApiV1Path(pathname) === '/api/v1/service/enterprise/accessible-project-documents/read') return await handleEnterpriseAccessibleProjectDocumentsService(event)
  requireForwardedServiceCapability(event)
  await enforceAimsAdminApiAccess(event, pathname)
  await enforceProjectCreateApiAccess(event, pathname)
  await enforceWorkItemBatchUpdateApiAccess(event, pathname)
  await enforceProjectDocumentDeleteApiAccess(event, pathname)

  const runtimeResponse = await maybeProxyCurrentApiToTenantRuntime(event, {
    appCode: APP_CODE,
    shouldForward: shouldForwardAimsRuntime,
    resolveScope: scopeFor,
    resolveQuery: resolveAimsRuntimeQuery
  })

  if (runtimeResponse !== undefined) return runtimeResponse

  if (isAllowedNuxtApiV1Path(pathname, event.node.req.method)) return

  if (isApiV1Path(pathname)) {
    throw createError({
      statusCode: 503,
      message: 'Aims tenant-runtime is required for /api/v1 data access.'
    })
  }
})

async function ensureConsoleAuthContext(event: H3Event) {
  const existing = event.context.consoleAuth as { authenticated?: unknown, reason?: unknown } | undefined
  if (existing && ('authenticated' in existing || 'reason' in existing)) return

  event.context.consoleAuth = await resolveConsoleAuthWithSessionBridge(event)
}

function shouldForwardAimsRuntime(context: TenantRuntimeProxyContext) {
  if (/^\/products(?:\/|$)/.test(context.suffix)
    || /^\/product-(?:permissions|candidates)$/.test(context.suffix)) return false
  if (context.method === 'PUT' && /^\/work-items\/[^/]+$/.test(context.suffix)) return false
  if (isAdminProductVersionsReadPath(context.suffix, context.method)) return false
  if (context.method === 'POST' && context.suffix === '/documents') return false
  if (isProductVersionRuntimePath(context.suffix, context.method)) return true
  if (isServiceContractRuntimePath(context.suffix, context.method)) return true

  if (context.method === 'GET' && /^\/work-items\/[^/]+\/breakdown-context$/.test(context.suffix)) return true
  if (context.method === 'GET' && /^\/work-items\/[^/]+\/(children|transitions|commits)$/.test(context.suffix)) return true
  if (isRequirementDetailRuntimePath(context)) return true
  if (isRequirementVersionRuntimePath(context)) return true
  if (isRequirementChangeDiffRuntimePath(context)) return true
  if (isRequirementChangeImpactRuntimePath(context)) return true
  if (isWorkItemCommitWritePath(context)) return true
  if (isWorkItemDeliverableRuntimePath(context)) return true
  if (isWorkItemSubmitRuntimePath(context)) return true
  if (isWorkItemWithdrawRuntimePath(context)) return true
  if (isWorkItemBatchRuntimePath(context)) return true
  if (isDeliverableBatchRuntimePath(context)) return true
  if (isMilestoneDetailRuntimePath(context)) return true
  if (isDirectMilestoneRuntimePath(context)) return true
  if (isProjectRepoRuntimePath(context)) return true
  if (context.method === 'GET' && /^\/service-lines\/[^/]+$/.test(context.suffix)) return true
  if (context.method === 'GET' && /^\/projects\/[^/]+\/routine-review$/.test(context.suffix)) return true
  if (context.method === 'GET' && /^\/projects\/[^/]+\/service-health$/.test(context.suffix)) return true
  if (context.method === 'GET' && /^\/projects\/[^/]+\/milestones\/[^/]+\/close-gate$/.test(context.suffix)) return true
  if (context.method === 'POST' && /^\/projects\/[^/]+\/milestones\/[^/]+:close$/.test(context.suffix)) return true
  if (context.method === 'GET' && context.suffix === '/projects/check-duplicate') return true
  if (context.suffix === '/admin/weekly-reporting-settings') {
    return context.method === 'GET' || context.method === 'PUT'
  }
  if (/^\/projects\/[^/]+\/manager-delegations$/.test(context.suffix)) {
    return context.method === 'GET' || context.method === 'POST'
  }
  if (/^\/projects\/[^/]+\/manager-delegations\/[^/]+:revoke$/.test(context.suffix)) {
    return context.method === 'POST'
  }
  if (/^\/weekly-reporting-periods\/[^/]+:generate$/.test(context.suffix)) {
    return context.method === 'POST'
  }
  if (/^\/projects\/[^/]+\/weekly-reports\/[^/]+:submit$/.test(context.suffix)) {
    return context.method === 'POST'
  }
  if (/^\/projects\/[^/]+\/weekly-reports\/[^/]+\/draft$/.test(context.suffix)) {
    return context.method === 'PUT'
  }
  if (/^\/projects\/[^/]+\/weekly-reports\/[^/]+$/.test(context.suffix)) {
    return context.method === 'GET'
  }
  if (/^\/weekly-reports\/[^/]+:(review|open-correction)$/.test(context.suffix)) {
    return context.method === 'POST'
  }
  if (/^\/weekly-reporting-periods\/[^/]+\/director-workbench$/.test(context.suffix)) {
    return context.method === 'GET'
  }
  if (/^\/company-weekly-summaries\/[^/]+$/.test(context.suffix)) {
    return context.method === 'GET'
  }
  if (/^\/company-weekly-summaries\/[^/]+:generate$/.test(context.suffix)) {
    return context.method === 'POST'
  }
  if (/^\/company-weekly-summaries\/[^/]+\/draft$/.test(context.suffix)) {
    return context.method === 'PUT'
  }
  if (/^\/company-weekly-summaries\/[^/]+:(open-correction)$/.test(context.suffix)) {
    return context.method === 'POST'
  }
  if (/^\/company-weekly-summaries\/[^/]+:cancel-publish$/.test(context.suffix)) {
    return context.method === 'POST'
  }
  if (/^\/company-weekly-summaries\/[^/]+\/versions$/.test(context.suffix)) {
    return context.method === 'GET'
  }
  if (/^\/timesheet\/weeks\/[^/]+:submit$/.test(context.suffix)) {
    return context.method === 'POST'
  }
  if (/^\/projects\/[^/]+\/time-entry-reviews$/.test(context.suffix)) {
    return context.method === 'GET' || context.method === 'POST'
  }
  if (context.suffix === '/qa-checklists') {
    return context.method === 'GET' || context.method === 'POST'
  }
  if (/^\/qa-checklists\/[^/]+:publish$/.test(context.suffix)) return context.method === 'POST'
  if (context.suffix === '/quality-reviews/queue') return context.method === 'GET'
  if (/^\/deliverable-submissions\/[^/]+:(confirm-completeness|review-quality)$/.test(context.suffix)) {
    return context.method === 'POST'
  }
  if (/^\/deliverables\/[^/]+\/waivers$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/deliverable-submissions\/[^/]+:activate-review$/.test(context.suffix)) return false

  if (context.suffix.startsWith('/codocs')) return false
  if (context.suffix.includes('codocs')) return false
  if (context.suffix.includes('/sync-gitlab')) return false
  if (context.method === 'GET' && NUXT_ONLY_GET_SUFFIX_PATTERNS.some(pattern => pattern.test(context.suffix))) return false
  if (NUXT_ONLY_MARKERS.some(marker => context.suffix.includes(marker))) return false

  if (/^\/projects\/[^/]+\/documents$/.test(context.suffix)) {
    return context.method === 'GET' || context.method === 'POST' || context.method === 'PUT' || context.method === 'PATCH'
  }
  if (/^\/work-items\/[^/]+\/documents$/.test(context.suffix)) {
    return context.method === 'GET' || context.method === 'POST' || context.method === 'DELETE'
  }
  if (/^\/work-items\/[^/]+\/documents\/[^/]+$/.test(context.suffix)) {
    return context.method === 'DELETE'
  }
  if (/^\/projects\/[^/]+\/members$/.test(context.suffix)) {
    return context.method === 'GET' || context.method === 'POST' || context.method === 'DELETE'
  }
  if (RUNTIME_READONLY_COLLECTIONS.includes(context.suffix)) return context.method === 'GET'
  if (context.suffix === '/favorites') return context.method === 'GET' || context.method === 'POST' || context.method === 'DELETE'
  if (RUNTIME_NESTED_ITEM_RESOURCES.some(pattern => pattern.test(context.suffix))) {
    return context.method === 'PATCH' || context.method === 'PUT' || context.method === 'DELETE'
  }
  if (RUNTIME_NESTED_RESOURCES.some(pattern => pattern.test(context.suffix))) return context.method === 'GET' || context.method === 'POST'
  return isCrudPath(context.suffix, context.method, RUNTIME_RESOURCES)
}

function isServiceContractRuntimePath(suffix: string, method: TenantRuntimeProxyContext['method']) {
  if (/^\/service\/products\/[^/]+\/version-summaries$/.test(suffix)) return method === 'GET'
  if (/^\/service\/projects\/[^/]+\/environments$/.test(suffix)) return method === 'GET' || method === 'POST'
  if (/^\/service\/projects\/[^/]+\/environments\/[^/]+:(status|assets-sync|remove)$/.test(suffix)) return method === 'POST'
  if (/^\/service\/environments\/[^/]+\/projects$/.test(suffix)) return method === 'GET'
  if (/^\/service\/projects\/[^/]+\/cost-summary$/.test(suffix)) return method === 'GET'
  if (/^\/service\/projects\/[^/]+\/cost-summary:recalculate$/.test(suffix)) return method === 'POST'
  if (suffix === '/service/projects/from-contract') return method === 'POST'
  if (suffix === '/service/projects/from-opportunity') return method === 'POST'
  if (suffix === '/service/projects/eligible-for-contract') return method === 'GET'
  if (suffix === '/service/project-management-facts') return method === 'GET'
  if (suffix === '/service/tasks') return method === 'GET'
  if (/^\/service\/projects\/by-contract\/[^/]+$/.test(suffix)) return method === 'GET'
  if (/^\/service\/projects\/[^/]+\/payment-milestones:sync$/.test(suffix)) return method === 'POST'
  if (/^\/service\/projects\/[^/]+\/people-contributions:freeze$/.test(suffix)) return method === 'POST'
  if (/^\/service\/projects\/[^/]+\/milestones\/[^/]+:rollover$/.test(suffix)) return method === 'POST'
  if (suffix === '/service/milestones:rollover-due') return method === 'POST'
  return false
}

interface ServiceCapabilityRequirement {
  scope: string
  allowedApps?: string[]
}

function serviceCapabilityRequirement(suffix: string, method: string): ServiceCapabilityRequirement | null {
  if (method === 'GET' && /^\/service\/products\/[^/]+\/version-summaries$/.test(suffix)) return { scope: 'aims:product-version-summary:read', allowedApps: ['assets'] }
  if (method === 'GET' && /^\/service\/products\/[^/]+\/versions$/.test(suffix)) {
    return { scope: 'aims:read', allowedApps: ['assets'] }
  }
  if (method === 'GET' && /^\/service\/projects\/[^/]+\/environments$/.test(suffix)) {
    return { scope: 'aims:read', allowedApps: ['altoc', 'assets', 'finance', 'aims'] }
  }
  if (method === 'GET' && /^\/service\/environments\/[^/]+\/projects$/.test(suffix)) {
    return { scope: 'aims:read', allowedApps: ['altoc', 'assets', 'finance', 'aims'] }
  }
  if (method === 'GET' && /^\/service\/projects\/[^/]+\/cost-summary$/.test(suffix)) {
    return { scope: 'aims:read', allowedApps: ['finance', 'people'] }
  }
  if (method === 'GET' && /^\/service\/projects\/by-contract\/[^/]+$/.test(suffix)) {
    return { scope: 'aims:read', allowedApps: ['altoc', 'aims'] }
  }
  if (method === 'GET' && suffix === '/service/projects/eligible-for-contract') {
    return { scope: 'aims:read', allowedApps: ['altoc', 'aims'] }
  }
  if (method === 'GET' && suffix === '/service/project-management-facts') {
    return { scope: 'aims:project-management-facts:read', allowedApps: ['people'] }
  }
  if (method === 'GET' && suffix === '/service/tasks') {
    return { scope: 'aims:tasks:read' }
  }
  if (method !== 'POST') return null

  if (suffix === '/service/notification-details/authorize' || suffix === '/service/notification-details/authorize/finalize') {
    return { scope: 'aims:notification-details:authorize', allowedApps: ['console'] }
  }
  if (suffix === '/service/workflow/callback') {
    return { scope: 'workflow:callback', allowedApps: ['workflow'] }
  }

  if (suffix === '/service/projects/from-contract') {
    return { scope: 'aims:write', allowedApps: ['altoc'] }
  }
  if (suffix === '/service/projects/from-opportunity') {
    return { scope: 'aims:project:create-from-opportunity', allowedApps: ['altoc'] }
  }
  if (/^\/service\/projects\/[^/]+\/environments$/.test(suffix)) {
    return { scope: 'aims:write', allowedApps: ['assets', 'altoc', 'aims'] }
  }
  if (/^\/service\/projects\/[^/]+\/environments\/[^/]+:(status|assets-sync|remove)$/.test(suffix)) {
    return { scope: 'aims:write', allowedApps: ['assets', 'altoc', 'aims'] }
  }
  if (/^\/service\/projects\/[^/]+\/cost-summary:recalculate$/.test(suffix)) {
    return { scope: 'aims:write', allowedApps: ['finance', 'people'] }
  }
  if (/^\/service\/projects\/[^/]+\/payment-milestones:sync$/.test(suffix)) {
    return { scope: 'aims:write', allowedApps: ['altoc', 'aims'] }
  }
  if (/^\/service\/projects\/[^/]+\/people-contributions:freeze$/.test(suffix)) {
    return { scope: 'aims:write', allowedApps: ['aims'] }
  }
  if (/^\/service\/projects\/[^/]+\/milestones\/[^/]+:rollover$/.test(suffix)) {
    return { scope: 'aims:write', allowedApps: ['aims'] }
  }
  if (suffix === '/service/milestones:rollover-due') {
    return { scope: 'aims:write', allowedApps: ['aims'] }
  }
  if (/^\/service\/service-tickets\/[^/]+\/work-item\/receive$/.test(suffix)) {
    return { scope: 'aims:service-ticket:work-item:create', allowedApps: ['altoc'] }
  }
  return null
}

function requireForwardedServiceCapability(event: H3Event) {
  const pathname = getRequestURL(event).pathname
  const apiPath = normalizedApiV1Path(pathname)
  if (!apiPath) return

  const method = String(event.node.req.method || 'GET').toUpperCase()
  const suffix = apiPath.slice(API_PREFIX.length) || '/'
  const requirement = serviceCapabilityRequirement(suffix, method)
  if (!requirement) {
    if (suffix.startsWith('/service/')) {
      throw createError({
        statusCode: 403,
        message: 'Unsupported Aims service endpoint capability.'
      })
    }
    return
  }

  requireServiceScope(event, requirement)
}

async function enforceAimsAdminApiAccess(event: H3Event, pathname: string) {
  const apiPath = normalizedApiV1Path(pathname)
  if (!apiPath) return

  const suffix = apiPath.slice(API_PREFIX.length) || '/'
  if (suffix !== '/admin' && !suffix.startsWith('/admin/')) return

  if (isAdminProjectDeleteRequest(event.node.req.method, suffix)) {
    await requireAimsProjectDeleteAccess(event)
    markAimsProjectDeleteAccessVerified(event)
    return
  }

  if (suffix === '/admin/projects' || suffix.startsWith('/admin/projects/')) {
    await requireAimsProjectManageAccess(event)
    return
  }

  await requireAimsAdminRoleAccess(event)
}

function isAdminProjectDeleteRequest(method: string | undefined, suffix: string) {
  return String(method || '').toUpperCase() === 'DELETE'
    && /^\/admin\/projects\/[^/]+$/.test(suffix)
}

function markAimsProjectDeleteAccessVerified(event: H3Event) {
  ;(event.context as AimsProjectDeleteAccessEventContext)[aimsProjectDeleteAccessVerifiedKey] = true
}

function isAimsProjectDeleteAccessVerified(event: H3Event) {
  return (event.context as AimsProjectDeleteAccessEventContext)[aimsProjectDeleteAccessVerifiedKey] === true
}

async function enforceProjectCreateApiAccess(event: H3Event, pathname: string) {
  const apiPath = normalizedApiV1Path(pathname)
  if (!apiPath) return

  const method = String(event.node.req.method || 'GET').toUpperCase()
  if (method !== 'POST' || apiPath !== '/api/v1/projects') return

  await requirePermission(event, 'projects', 'create', '需要 AIMS 项目创建权限才可以创建项目')
}

async function enforceWorkItemBatchUpdateApiAccess(event: H3Event, pathname: string) {
  const apiPath = normalizedApiV1Path(pathname)
  if (!apiPath) return

  const method = String(event.node.req.method || 'GET').toUpperCase()
  if (method !== 'PATCH' || apiPath !== '/api/v1/work-items/batch') return

  await requirePermission(event, 'work_items', 'edit', '需要 AIMS 工作项编辑权限才可以批量更新工作项')
}

async function enforceProjectDocumentDeleteApiAccess(event: H3Event, pathname: string) {
  const apiPath = normalizedApiV1Path(pathname)
  if (!apiPath) return

  const method = String(event.node.req.method || 'GET').toUpperCase()
  if (method !== 'DELETE') return

  const documentMatch = apiPath.match(/^\/api\/v1\/documents\/(\d+)$/)
  if (!documentMatch) return

  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  await requireProjectDocumentDeleteAccess(
    event,
    Number(documentMatch[1]),
    uid,
    '仅项目经理或上传人可以删除项目文档'
  )
}

function isProductVersionRuntimePath(suffix: string, method: TenantRuntimeProxyContext['method']) {
  if (/^\/admin\/products\/[^/]+\/versions$/.test(suffix)) {
    return method === 'GET' || method === 'POST'
  }
  if (/^\/admin\/product-versions\/[^/]+$/.test(suffix)) {
    return method === 'GET' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
  }
  if (/^\/admin\/product-versions\/[^/]+\/transition$/.test(suffix)) {
    return method === 'POST'
  }
  if (/^\/admin\/product-versions\/[^/]+\/features$/.test(suffix)) {
    return method === 'GET' || method === 'POST'
  }
  if (/^\/admin\/product-versions\/[^/]+\/features\/[^/]+$/.test(suffix)) {
    return method === 'PUT' || method === 'PATCH' || method === 'DELETE'
  }
  if (/^\/projects\/[^/]+\/products$/.test(suffix)) {
    return method === 'GET' || method === 'POST'
  }
  if (/^\/projects\/[^/]+\/products\/[^/]+$/.test(suffix)) {
    return method === 'PUT' || method === 'PATCH' || method === 'DELETE'
  }
  if (/^\/projects\/[^/]+\/products\/[^/]+\/primary$/.test(suffix)) {
    return method === 'PUT'
  }
  if (/^\/projects\/[^/]+\/releases(\/.*)?$/.test(suffix)) {
    return method === 'GET' || method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
  }
  return false
}

function isAdminProductVersionsReadPath(suffix: string, method: TenantRuntimeProxyContext['method']) {
  return method === 'GET' && /^\/admin\/products\/[^/]+\/versions$/.test(suffix)
}

function isAllowedNuxtApiV1Path(pathname: string, method: string | undefined) {
  const apiPath = normalizedApiV1Path(pathname)
  if (!apiPath) return false

  if (String(method || 'GET').toUpperCase() === 'GET' && NUXT_ONLY_GET_PATTERNS.some(pattern => pattern.test(apiPath))) return true
  if (NUXT_ONLY_PATTERNS.some(pattern => pattern.test(apiPath))) return true
  if (NUXT_ONLY_MARKER_ROUTE_PATTERNS.some(pattern => pattern.test(apiPath))) return true
  return apiPath.endsWith('/api/v1/codocs/department-documents')
    || apiPath.endsWith('/api/v1/codocs/project-documents')
    || apiPath.includes('/api/v1/codocs/documents/')
}

function scopeFor(context: TenantRuntimeProxyContext) {
  if (context.method === 'GET' && /^\/service\/products\/[^/]+\/version-summaries$/.test(context.suffix)) return 'aims.read aims:product-version-summary:read'
  return context.method === 'GET' ? 'aims.read' : 'aims.write'
}

async function resolveAimsRuntimeQuery(context: TenantRuntimeProxyContext, query: Record<string, unknown>) {
  const sanitizedQuery = { ...query }
  delete sanitizedQuery.current_user_dept_codes
  delete sanitizedQuery.currentUserDeptCodes
  delete sanitizedQuery.current_user_dept_code
  delete sanitizedQuery.currentUserDeptCode
  delete sanitizedQuery.user_dept_codes
  delete sanitizedQuery.userDeptCodes
  delete sanitizedQuery.current_user_management_dept_codes
  delete sanitizedQuery.currentUserManagementDeptCodes
  delete sanitizedQuery.management_dept_codes
  delete sanitizedQuery.managementDeptCodes
  delete sanitizedQuery.current_user_is_project_admin
  delete sanitizedQuery.currentUserIsProjectAdmin
  delete sanitizedQuery.current_user_project_admin_dept_codes
  delete sanitizedQuery.currentUserProjectAdminDeptCodes
  delete sanitizedQuery.project_admin_dept_codes
  delete sanitizedQuery.projectAdminDeptCodes
  delete sanitizedQuery.current_user_project_admin_project_codes
  delete sanitizedQuery.currentUserProjectAdminProjectCodes
  delete sanitizedQuery.project_admin_project_codes
  delete sanitizedQuery.projectAdminProjectCodes
  delete sanitizedQuery.current_user_project_admin_member_project_codes
  delete sanitizedQuery.currentUserProjectAdminMemberProjectCodes
  delete sanitizedQuery.project_admin_member_project_codes
  delete sanitizedQuery.projectAdminMemberProjectCodes
  delete sanitizedQuery.current_user_project_admin_owner_project_codes
  delete sanitizedQuery.currentUserProjectAdminOwnerProjectCodes
  delete sanitizedQuery.project_admin_owner_project_codes
  delete sanitizedQuery.projectAdminOwnerProjectCodes
  delete sanitizedQuery.current_user_can_view_weekly_report_summary
  delete sanitizedQuery.currentUserCanViewWeeklyReportSummary
  delete sanitizedQuery.current_user_approval_decision_authorized
  delete sanitizedQuery.currentUserApprovalDecisionAuthorized
  delete sanitizedQuery.current_user_can_manage_portfolios
  delete sanitizedQuery.currentUserCanManagePortfolios
  delete sanitizedQuery.current_user_is_project_director
  delete sanitizedQuery.currentUserIsProjectDirector
  delete sanitizedQuery.current_user_project_director_revision
  delete sanitizedQuery.currentUserProjectDirectorRevision
  delete sanitizedQuery.current_user_can_configure_weekly_reports
  delete sanitizedQuery.currentUserCanConfigureWeeklyReports
  delete sanitizedQuery.current_user_can_submit_weekly_report
  delete sanitizedQuery.currentUserCanSubmitWeeklyReport
  delete sanitizedQuery.current_user_can_submit_assigned_weekly_report
  delete sanitizedQuery.currentUserCanSubmitAssignedWeeklyReport
  delete sanitizedQuery.current_user_can_submit_timesheet
  delete sanitizedQuery.currentUserCanSubmitTimesheet
  delete sanitizedQuery.current_user_can_approve_timesheet
  delete sanitizedQuery.currentUserCanApproveTimesheet
  delete sanitizedQuery.current_user_can_review_assigned_timesheet
  delete sanitizedQuery.currentUserCanReviewAssignedTimesheet
  delete sanitizedQuery.current_user_document_version_resolved
  delete sanitizedQuery.currentUserDocumentVersionResolved
  delete sanitizedQuery.current_user_document_review_grant_created
  delete sanitizedQuery.currentUserDocumentReviewGrantCreated
  delete sanitizedQuery.current_user_repository_review_snapshot_resolved
  delete sanitizedQuery.currentUserRepositoryReviewSnapshotResolved
  delete sanitizedQuery.current_user_can_view_quality_reviews
  delete sanitizedQuery.currentUserCanViewQualityReviews
  delete sanitizedQuery.current_user_can_review_quality_reviews
  delete sanitizedQuery.currentUserCanReviewQualityReviews
  delete sanitizedQuery.current_user_can_configure_quality_reviews
  delete sanitizedQuery.currentUserCanConfigureQualityReviews
  delete sanitizedQuery.current_user_can_waive_quality_reviews
  delete sanitizedQuery.currentUserCanWaiveQualityReviews
  delete sanitizedQuery.current_user_is_qa
  delete sanitizedQuery.currentUserIsQa
  delete sanitizedQuery.current_user_qa_revision
  delete sanitizedQuery.currentUserQaRevision

  if (context.method === 'GET' && context.suffix === '/weekly-reports/export-data' && !await hasWeeklyReportRuntimeAccess(context)) {
    throw createError({ statusCode: 403, message: '权限不足' })
  }
  await applyApprovalDecisionContext(context, sanitizedQuery)
  await applyPortfolioManageContext(context, sanitizedQuery)
  await applyProjectGovernanceRoleContext(context, sanitizedQuery)
  await applyTimesheetGovernanceContext(context, sanitizedQuery)
  await applyQualityGovernanceContext(context, sanitizedQuery)

  if (needsWeeklyReportSummaryViewContext(context)) {
    sanitizedQuery.current_user_can_view_weekly_report_summary = context.method === 'GET' && context.suffix === '/weekly-reports'
      ? '1'
      : await hasWeeklyReportRuntimeAccess(context) ? '1' : '0'
  }
  if (needsProductAdminContext(context)) {
    sanitizedQuery.current_user_is_project_admin = await hasAimsSystemManageAccess(context.event) ? '1' : '0'
  }
  if (needsProjectObjectAdminContext(context)) {
    const hasProjectObjectAdmin = await hasProjectObjectAdminAccess(context)
    sanitizedQuery.current_user_is_project_admin = sanitizedQuery.current_user_is_project_admin === '1' || hasProjectObjectAdmin ? '1' : '0'
  }

  const needsVisibilityContext = needsProjectVisibilityContext(context)
  const needsAdminListScopeContext = needsProjectScopedAdminListContext(context)
  if (!needsVisibilityContext && !needsAdminListScopeContext) return sanitizedQuery

  const visibilityContext = await resolveCurrentUserProjectVisibilityContext(context.event, context.currentUser)
  if (visibilityContext.deptCodes.length > 0) {
    sanitizedQuery.current_user_dept_codes = visibilityContext.deptCodes.join(',')
  }
  if (visibilityContext.managementDeptCodes.length > 0) {
    sanitizedQuery.current_user_management_dept_codes = visibilityContext.managementDeptCodes.join(',')
  }
  if (context.method === 'GET' && context.suffix === '/projects') {
    Object.assign(sanitizedQuery, await resolveAimsProjectListAdminScopeQuery(context.event, context.currentUser, visibilityContext))
  }
  if (needsAdminListScopeContext) {
    Object.assign(sanitizedQuery, await resolveAimsProjectListAdminScopeQuery(context.event, context.currentUser, visibilityContext))
  }
  return sanitizedQuery
}

async function applyQualityGovernanceContext(
  context: TenantRuntimeProxyContext,
  sanitizedQuery: Record<string, unknown>
) {
  const checklistPath = context.suffix === '/qa-checklists' || /^\/qa-checklists\/[^/]+:publish$/.test(context.suffix)
  const queuePath = context.suffix === '/quality-reviews/queue'
  const qualityReviewPath = /^\/deliverable-submissions\/[^/]+:review-quality$/.test(context.suffix)
  const completenessPath = /^\/deliverable-submissions\/[^/]+:confirm-completeness$/.test(context.suffix)
  const waiverPath = /^\/deliverables\/[^/]+\/waivers$/.test(context.suffix)
  if (!checklistPath && !queuePath && !qualityReviewPath && !completenessPath && !waiverPath) return

  const [canView, canReview, canConfigure, canWaive] = await Promise.all([
    checkPermission(context.event, 'quality_reviews', 'view'),
    checkPermission(context.event, 'quality_reviews', 'review'),
    checkPermission(context.event, 'quality_reviews', 'configure'),
    checkPermission(context.event, 'quality_reviews', 'waive')
  ])
  sanitizedQuery.current_user_can_view_quality_reviews = canView ? '1' : '0'
  sanitizedQuery.current_user_can_configure_quality_reviews = canConfigure ? '1' : '0'
  sanitizedQuery.current_user_can_waive_quality_reviews = canWaive ? '1' : '0'

  if (checklistPath && context.method === 'GET' && !canView) {
    throw createError({ statusCode: 403, message: '需要文档质量检查查看权限' })
  }
  if (checklistPath && context.method !== 'GET') {
    if (!canConfigure) throw createError({ statusCode: 403, message: '需要 QA 检查清单配置权限' })
    const holder = await requireCurrentProjectGovernanceRoleHolder(context.event, 'qa', context.currentUser)
    sanitizedQuery.current_user_is_qa = '1'
    sanitizedQuery.current_user_qa_revision = String(holder.revision)
  }
  if (completenessPath) return
  if (waiverPath) {
    if (!canWaive) throw createError({ statusCode: 403, message: '需要文档质量豁免权限' })
    const holder = await requireCurrentProjectGovernanceRoleHolder(context.event, 'project_director', context.currentUser)
    sanitizedQuery.current_user_is_project_director = '1'
    sanitizedQuery.current_user_project_director_revision = String(holder.revision)
    return
  }
  if (queuePath || qualityReviewPath) {
    let matched = false
    if (canReview) {
      const qa = await resolveProjectGovernanceRoleHolder(context.event, 'qa')
      if (qa.uid === context.currentUser) {
        sanitizedQuery.current_user_is_qa = '1'
        sanitizedQuery.current_user_qa_revision = String(qa.revision)
        matched = true
      }
    }
    if (!matched && canWaive) {
      const director = await resolveProjectGovernanceRoleHolder(context.event, 'project_director')
      if (director.uid === context.currentUser) {
        sanitizedQuery.current_user_is_project_director = '1'
        sanitizedQuery.current_user_project_director_revision = String(director.revision)
        matched = true
      }
    }
    if (!matched) throw createError({ statusCode: 403, message: '仅当前 QA 或冲突转交后的项目总监可以处理质量检查' })
    sanitizedQuery.current_user_can_review_quality_reviews = '1'
  }
}

function needsProjectVisibilityContext(context: TenantRuntimeProxyContext) {
  return context.method === 'GET'
    && (
      context.suffix === '/projects'
      || context.suffix === '/approvals'
      || context.suffix === '/deliverables'
      || context.suffix === '/documents'
      || context.suffix === '/milestones'
      || context.suffix === '/requirements'
      || context.suffix === '/requirement-contents'
      || context.suffix === '/requirement-reviews'
      || context.suffix === '/work-items'
      || isMilestoneDetailRuntimePath(context)
      || isDirectMilestoneRuntimePath(context)
      || /^\/projects\/[^/]+$/.test(context.suffix)
      || /^\/projects\/[^/]+\/members$/.test(context.suffix)
      || /^\/projects\/[^/]+\/documents$/.test(context.suffix)
      || Boolean(projectProductVersionPath(context.suffix))
      || Boolean(projectScopedNestedCollection(context.suffix))
      || /^\/projects\/[^/]+\/time-entries$/.test(context.suffix)
      || /^\/projects\/[^/]+\/weekly-reports$/.test(context.suffix)
    )
}

function needsProjectObjectAdminContext(context: TenantRuntimeProxyContext) {
  const scopedNested = projectScopedNestedCollection(context.suffix)
  if (scopedNested) {
    return context.method === 'GET'
      || (context.method === 'POST' && projectScopedNestedCollectionSupportsWrite(scopedNested.collection))
      || (context.method === 'DELETE' && scopedNested.collection === 'repos')
  }
  if (projectProductVersionPath(context.suffix)) {
    return context.method === 'GET'
      || context.method === 'POST'
      || context.method === 'PUT'
      || context.method === 'PATCH'
      || context.method === 'DELETE'
  }
  if (/^\/projects\/[^/]+\/documents$/.test(context.suffix)) {
    return context.method === 'GET'
      || context.method === 'POST'
      || context.method === 'PUT'
      || context.method === 'PATCH'
  }
  if (/^\/projects\/[^/]+\/weekly-reports$/.test(context.suffix)) return false
  if (/^\/projects\/[^/]+\/time-entries(?:\/[^/]+)?$/.test(context.suffix)) {
    return context.method === 'GET'
      || context.method === 'POST'
      || context.method === 'PATCH'
      || context.method === 'PUT'
      || context.method === 'DELETE'
  }
  if (/^\/projects\/[^/]+\/members$/.test(context.suffix)) {
    return context.method === 'GET' || context.method === 'POST' || context.method === 'DELETE'
  }
  if (!/^\/(?:admin\/)?projects\/[^/]+$/.test(context.suffix)) return false
  return context.method === 'GET'
    || context.method === 'PATCH'
    || context.method === 'PUT'
    || context.method === 'DELETE'
}

function needsProjectScopedAdminListContext(context: TenantRuntimeProxyContext) {
  if (context.method === 'GET' && context.suffix === '/approvals') return true
  if (context.method === 'GET' && (
    context.suffix === '/deliverables'
    || context.suffix === '/documents'
    || context.suffix === '/milestones'
    || context.suffix === '/requirements'
    || context.suffix === '/requirement-contents'
    || context.suffix === '/requirement-reviews'
    || context.suffix === '/work-items'
  )) return true

  return (
    (context.method === 'PATCH' || context.method === 'PUT' || context.method === 'DELETE')
    && DIRECT_PROJECT_SCOPED_ADMIN_OBJECT_PATTERN.test(context.suffix)
  ) || (context.method === 'GET' && /^\/work-items\/[^/]+$/.test(context.suffix))
  || isDirectMilestoneRuntimePath(context)
  || isWorkItemCommitRuntimePath(context)
  || isWorkItemDeliverableRuntimePath(context)
  || isWorkItemSubmitRuntimePath(context)
  || isWorkItemWithdrawRuntimePath(context)
  || isWorkItemBatchRuntimePath(context)
  || isDeliverableBatchRuntimePath(context)
  || isWorkItemCommentRuntimePath(context)
  || isWorkItemDocumentRuntimePath(context)
  || isWorkItemTimeEntryRuntimePath(context)
  || isRequirementDetailRuntimePath(context)
  || isRequirementVersionRuntimePath(context)
  || isRequirementChangeDiffRuntimePath(context)
  || isRequirementChangeImpactRuntimePath(context)
  || isMilestoneDetailRuntimePath(context)
}

function needsPortfolioManageContext(context: TenantRuntimeProxyContext) {
  return isPortfolioCreateContext(context)
    || isPortfolioMutationContext(context)
}

function isPortfolioCreateContext(context: TenantRuntimeProxyContext) {
  return context.method === 'POST' && context.suffix === '/portfolios'
}

function isPortfolioMutationContext(context: TenantRuntimeProxyContext) {
  return (context.method === 'PATCH' || context.method === 'PUT' || context.method === 'DELETE')
    && /^\/portfolios\/[^/]+$/.test(context.suffix)
}

async function applyPortfolioManageContext(context: TenantRuntimeProxyContext, sanitizedQuery: Record<string, unknown>) {
  if (!needsPortfolioManageContext(context)) return
  if (isPortfolioCreateContext(context)) {
    await requirePermission(context.event, 'admin', 'admin', '仅系统管理员可以创建项目集')
  } else {
    await requirePermission(context.event, 'portfolios', 'admin', '仅 AIMS 管理员可以维护项目集')
  }
  sanitizedQuery.current_user_can_manage_portfolios = '1'
}

async function applyProjectGovernanceRoleContext(
  context: TenantRuntimeProxyContext,
  sanitizedQuery: Record<string, unknown>
) {
  const settingsPath = context.suffix === '/admin/weekly-reporting-settings'
  const delegationPath = /^\/projects\/[^/]+\/manager-delegations(?:\/[^/]+:revoke)?$/.test(context.suffix)
  const periodGeneratePath = /^\/weekly-reporting-periods\/[^/]+:generate$/.test(context.suffix)
  const projectWeeklyReportPath = /^\/projects\/[^/]+\/weekly-reports$/.test(context.suffix)
  const projectWeeklyReportPeriodPath = /^\/projects\/[^/]+\/weekly-reports\/[^/]+(?::submit|\/draft)?$/.test(context.suffix)
  const weeklyReportDirectorCommandPath = /^\/weekly-reports\/[^/]+:(review|open-correction)$/.test(context.suffix)
  const directorWorkbenchPath = /^\/weekly-reporting-periods\/[^/]+\/director-workbench$/.test(context.suffix)
  const companySummaryPath = /^\/company-weekly-summaries\/[^/]+(?::(?:generate|open-correction|cancel-publish)|\/(?:draft|versions))?$/.test(context.suffix)
  if (
    !settingsPath
    && !delegationPath
    && !periodGeneratePath
    && !projectWeeklyReportPath
    && !projectWeeklyReportPeriodPath
    && !weeklyReportDirectorCommandPath
    && !directorWorkbenchPath
    && !companySummaryPath
  ) return

  const [isProjectDirector, canConfigure, canSubmit, canView] = await Promise.all([
    checkPermission(context.event, 'weekly_reports', 'review'),
    checkPermission(context.event, 'weekly_reports', 'configure'),
    checkPermission(context.event, 'weekly_reports', 'submit'),
    checkPermission(context.event, 'weekly_reports', 'view')
  ])
  const canSubmitAssignedReport = canSubmit || canView
  sanitizedQuery.current_user_is_project_director = isProjectDirector ? '1' : '0'
  sanitizedQuery.current_user_can_configure_weekly_reports = canConfigure ? '1' : '0'
  sanitizedQuery.current_user_can_submit_weekly_report = canSubmit ? '1' : '0'
  sanitizedQuery.current_user_can_submit_assigned_weekly_report = canSubmitAssignedReport ? '1' : '0'

  if (settingsPath && !canConfigure) {
    throw createError({ statusCode: 403, message: '需要项目周报配置权限' })
  }
  if (delegationPath && context.method !== 'GET' && !isProjectDirector) {
    throw createError({ statusCode: 403, message: '仅当前项目总监可以指定或撤销代理项目经理' })
  }
  if (delegationPath && context.method !== 'GET') {
    const holder = await requireCurrentProjectGovernanceRoleHolder(
      context.event,
      'project_director',
      context.currentUser
    )
    sanitizedQuery.current_user_project_director_revision = String(holder.revision)
  }
  if (periodGeneratePath && !isProjectDirector && !canConfigure) {
    throw createError({ statusCode: 403, message: '需要项目总监或项目周报配置权限' })
  }
  if (periodGeneratePath && isProjectDirector && !canConfigure) {
    const holder = await requireCurrentProjectGovernanceRoleHolder(
      context.event,
      'project_director',
      context.currentUser
    )
    sanitizedQuery.current_user_project_director_revision = String(holder.revision)
  }
  if (projectWeeklyReportPath && context.method === 'POST' && !canSubmitAssignedReport) {
    throw createError({ statusCode: 403, message: '需要项目周报提交权限' })
  }
  if (projectWeeklyReportPeriodPath && context.method !== 'GET' && !canSubmitAssignedReport) {
    throw createError({ statusCode: 403, message: '需要项目周报提交权限' })
  }
  if ((weeklyReportDirectorCommandPath || directorWorkbenchPath || companySummaryPath) && !isProjectDirector) {
    throw createError({ statusCode: 403, message: '仅当前项目总监可以审阅项目周报' })
  }
  if (weeklyReportDirectorCommandPath || companySummaryPath) {
    const holder = await requireCurrentProjectGovernanceRoleHolder(
      context.event,
      'project_director',
      context.currentUser
    )
    sanitizedQuery.current_user_project_director_revision = String(holder.revision)
  }
}

async function applyTimesheetGovernanceContext(
  context: TenantRuntimeProxyContext,
  sanitizedQuery: Record<string, unknown>
) {
  const weekSubmitPath = /^\/timesheet\/weeks\/[^/]+:submit$/.test(context.suffix)
  const reviewPath = /^\/projects\/[^/]+\/time-entry-reviews$/.test(context.suffix)
  if (!weekSubmitPath && !reviewPath) return

  if (weekSubmitPath) {
    await requirePermission(context.event, 'timesheet', 'submit', '需要工时提交权限')
    sanitizedQuery.current_user_can_submit_timesheet = '1'
  }
  if (reviewPath) {
    const [canApprove, canSubmit] = await Promise.all([
      checkPermission(context.event, 'timesheet', 'approve'),
      checkPermission(context.event, 'timesheet', 'submit')
    ])
    if (!canApprove && !canSubmit) {
      throw createError({ statusCode: 403, message: '需要工时审核权限或被分派的项目经理职责' })
    }
    sanitizedQuery.current_user_can_approve_timesheet = canApprove ? '1' : '0'
    sanitizedQuery.current_user_can_review_assigned_timesheet = '1'
  }
}

function isWorkItemCommitWritePath(context: TenantRuntimeProxyContext) {
  return (context.method === 'POST' && /^\/work-items\/[^/]+\/commits$/.test(context.suffix))
    || (context.method === 'DELETE' && /^\/work-items\/[^/]+\/commits\/[^/]+$/.test(context.suffix))
}

function isWorkItemCommitRuntimePath(context: TenantRuntimeProxyContext) {
  return (context.method === 'GET' && /^\/work-items\/[^/]+\/commits$/.test(context.suffix))
    || isWorkItemCommitWritePath(context)
}

function isWorkItemDeliverableRuntimePath(context: TenantRuntimeProxyContext) {
  return (context.method === 'PATCH' || context.method === 'PUT')
    && /^\/work-items\/[^/]+\/deliverables\/[^/]+$/.test(context.suffix)
}

function isWorkItemSubmitRuntimePath(context: TenantRuntimeProxyContext) {
  return context.method === 'POST'
    && /^\/work-items\/[^/]+\/submit$/.test(context.suffix)
}

function isWorkItemWithdrawRuntimePath(context: TenantRuntimeProxyContext) {
  return context.method === 'POST'
    && /^\/work-items\/[^/]+\/withdraw$/.test(context.suffix)
}

function isWorkItemBatchRuntimePath(context: TenantRuntimeProxyContext) {
  return context.method === 'PATCH'
    && context.suffix === '/work-items/batch'
}

function isDeliverableBatchRuntimePath(context: TenantRuntimeProxyContext) {
  return context.method === 'POST'
    && context.suffix === '/deliverables/batch'
}

function isMilestoneDetailRuntimePath(context: TenantRuntimeProxyContext) {
  return context.method === 'GET'
    && /^\/milestones\/[^/]+\/detail$/.test(context.suffix)
}

function isDirectMilestoneRuntimePath(context: TenantRuntimeProxyContext) {
  return (
    context.method === 'GET'
    || context.method === 'PATCH'
    || context.method === 'PUT'
    || context.method === 'DELETE'
  ) && /^\/milestones\/[^/]+$/.test(context.suffix)
}

function isProjectRepoRuntimePath(context: TenantRuntimeProxyContext) {
  return (context.method === 'GET' || context.method === 'POST' || context.method === 'DELETE')
    && /^\/projects\/[^/]+\/repos$/.test(context.suffix)
}

function isWorkItemCommentRuntimePath(context: TenantRuntimeProxyContext) {
  return (context.method === 'GET' || context.method === 'POST')
    && /^\/work-items\/[^/]+\/comments$/.test(context.suffix)
}

function isWorkItemDocumentRuntimePath(context: TenantRuntimeProxyContext) {
  return (
    (context.method === 'GET' || context.method === 'POST' || context.method === 'DELETE')
    && /^\/work-items\/[^/]+\/documents$/.test(context.suffix)
  ) || (
    context.method === 'DELETE'
    && /^\/work-items\/[^/]+\/documents\/[^/]+$/.test(context.suffix)
  )
}

function isWorkItemTimeEntryRuntimePath(context: TenantRuntimeProxyContext) {
  return (
    (context.method === 'GET' || context.method === 'POST')
    && /^\/work-items\/[^/]+\/time-entries$/.test(context.suffix)
  ) || (
    (context.method === 'PATCH' || context.method === 'PUT' || context.method === 'DELETE')
    && /^\/work-items\/[^/]+\/time-entries\/[^/]+$/.test(context.suffix)
  )
}

function isRequirementDetailRuntimePath(context: TenantRuntimeProxyContext) {
  return context.method === 'GET'
    && /^\/requirements\/[^/]+$/.test(context.suffix)
}

function isRequirementVersionRuntimePath(context: TenantRuntimeProxyContext) {
  return context.method === 'GET'
    && /^\/requirements\/[^/]+\/versions$/.test(context.suffix)
}

function isRequirementChangeDiffRuntimePath(context: TenantRuntimeProxyContext) {
  return context.method === 'GET'
    && /^\/requirements\/[^/]+\/change-diff$/.test(context.suffix)
}

function isRequirementChangeImpactRuntimePath(context: TenantRuntimeProxyContext) {
  return context.method === 'GET'
    && /^\/requirements\/[^/]+\/change-impact$/.test(context.suffix)
}

function needsApprovalDecisionContext(context: TenantRuntimeProxyContext) {
  return (context.method === 'PATCH' || context.method === 'PUT' || context.method === 'DELETE')
    && /^\/approvals\/[^/]+$/.test(context.suffix)
}

async function applyApprovalDecisionContext(context: TenantRuntimeProxyContext, sanitizedQuery: Record<string, unknown>) {
  if (!needsApprovalDecisionContext(context)) return
  if (context.method === 'DELETE') return

  const match = context.suffix.match(/^\/approvals\/([^/]+)$/)
  if (!match) return
  const approvalId = decodeURIComponent(match[1] || '')
  const approval = await callAimsRuntime<RuntimeApprovalRecord>(
    context.event,
    `/v1/aims/approvals/${encodeURIComponent(approvalId)}`,
    {
      query: { current_user: context.currentUser, operator_uid: context.currentUser },
      scope: 'aims.read'
    }
  )

  if (String(approval.status || '').trim() !== 'pending') {
    throw createError({ statusCode: 400, message: '该审核已处理' })
  }
  const reviewerUid = String(approval.reviewerUid ?? approval.reviewer_uid ?? '').trim()
  if (reviewerUid && reviewerUid !== context.currentUser) {
    throw createError({ statusCode: 403, message: '您不是该审核的指定审核人' })
  }

  const workItemOwnerId = Number(approval.workItemOwnerId ?? approval.work_item_owner_id) || 0
  if (workItemOwnerId > 0) {
    await requirePermission(context.event, 'work_items', 'confirm', '需要 AIMS 工作项确认权限才可以处理工作项审批')
  } else {
    await requirePermission(context.event, 'projects', 'approve', '需要 AIMS 项目审批权限才可以处理项目或里程碑审批')
  }
  sanitizedQuery.current_user_approval_decision_authorized = '1'
}

function needsProductAdminContext(context: TenantRuntimeProxyContext) {
  return /^\/admin\/products\/[^/]+\/versions$/.test(context.suffix)
    || /^\/admin\/product-versions\/[^/]+(\/transition)?$/.test(context.suffix)
    || /^\/admin\/product-versions\/[^/]+\/features(\/[^/]+)?$/.test(context.suffix)
    || /^\/project-template-versions(\/[^/]+(\/transition)?)?$/.test(context.suffix)
}

function projectObjectId(context: TenantRuntimeProxyContext) {
  const scopedNested = projectScopedNestedCollection(context.suffix)
  if (scopedNested) return scopedNested.projectId
  const productVersionProjectId = projectProductVersionProjectId(context.suffix)
  if (productVersionProjectId) return productVersionProjectId
  const documentsMatch = context.suffix.match(/^\/projects\/([^/]+)\/documents$/)
  if (documentsMatch) return decodeURIComponent(documentsMatch[1] || '')
  const weeklyReportsMatch = context.suffix.match(/^\/projects\/([^/]+)\/weekly-reports$/)
  if (weeklyReportsMatch) return decodeURIComponent(weeklyReportsMatch[1] || '')
  const timeEntriesMatch = context.suffix.match(/^\/projects\/([^/]+)\/time-entries(?:\/[^/]+)?$/)
  if (timeEntriesMatch) return decodeURIComponent(timeEntriesMatch[1] || '')
  const match = context.suffix.match(/^\/(?:admin\/)?projects\/([^/]+)(?:\/members)?$/)
  return match ? decodeURIComponent(match[1] || '') : ''
}

function isAdminProjectObjectPath(context: TenantRuntimeProxyContext) {
  return /^\/admin\/projects\/[^/]+$/.test(context.suffix)
}

function projectScopedNestedCollection(suffix: string) {
  const match = suffix.match(/^\/projects\/([^/]+)\/([^/]+)$/)
  if (!match) return null
  const collection = match[2] || ''
  if (![
    'repos',
    'milestones',
    'work-items',
    'requirements',
    'requirement-contents',
    'requirement-reviews',
    'gitlab-commits'
  ].includes(collection)) {
    return null
  }
  return {
    projectId: decodeURIComponent(match[1] || ''),
    collection
  }
}

function projectScopedNestedCollectionSupportsWrite(collection: string) {
  return [
    'repos',
    'milestones',
    'work-items',
    'requirements',
    'requirement-contents',
    'requirement-reviews'
  ].includes(collection)
}

function projectProductVersionPath(suffix: string) {
  return Boolean(projectProductVersionProjectId(suffix))
}

function projectProductVersionProjectId(suffix: string) {
  const match = suffix.match(/^\/projects\/([^/]+)\/(?:products|releases)(?:\/.*)?$/)
  return match ? decodeURIComponent(match[1] || '') : ''
}

function needsWeeklyReportSummaryViewContext(context: TenantRuntimeProxyContext) {
  return context.suffix === '/weekly-reports'
    || context.suffix === '/weekly-reports/export-data'
}

async function hasWeeklyReportManageAccess(event: TenantRuntimeProxyContext['event']) {
  return await checkPermission(event, 'weekly_reports', 'submit')
}

async function hasWeeklyReportRuntimeAccess(context: TenantRuntimeProxyContext) {
  if (context.method === 'GET' && context.suffix === '/weekly-reports/export-data') {
    return await checkPermission(context.event, 'weekly_reports', 'export')
  }

  if (
    context.method === 'GET'
    && context.suffix === '/weekly-reports'
  ) {
    return await checkPermission(context.event, 'weekly_reports', 'view')
  }

  return await hasWeeklyReportManageAccess(context.event)
}

async function hasProjectObjectAdminAccess(context: TenantRuntimeProxyContext) {
  if (isAdminProjectDeleteRequest(context.method, context.suffix)) {
    return isAimsProjectDeleteAccessVerified(context.event)
  }

  // admin 口径统一收口为 Aims admin:admin 权限；其余角色仍需对象级 scope 覆盖才放行。
  if (await hasAimsAdminRoleAccess(context.event)) {
    return true
  }

  if (isAdminProjectObjectPath(context)) {
    return await checkAimsScopedPermission(context.event, {
      resourceCode: 'projects',
      action: 'admin'
    })
  }

  const projectId = projectObjectId(context)
  if (!projectId || !context.currentUser) {
    return false
  }

  const visibilityContext = await resolveCurrentUserProjectVisibilityContext(context.event, context.currentUser)
  const object = await resolveAimsProjectAuthorizationObject(context.event, {
    projectId,
    uid: context.currentUser,
    currentDeptCodes: [...new Set([...context.currentDeptCodes, ...visibilityContext.deptCodes])],
    managementDeptCodes: visibilityContext.managementDeptCodes
  })

  return await checkAimsScopedPermission(context.event, {
    resourceCode: 'projects',
    action: 'admin',
    object
  })
}

async function resolveCurrentUserProjectVisibilityContext(event: H3Event, uid: string) {
  const normalizedUid = String(uid || '').trim()
  if (!normalizedUid) return { deptCodes: [], managementDeptCodes: [] }

  try {
    const result = await fetchUserDepartments(event, normalizedUid)
    const codes = new Set<string>()
    if (result.primaryDeptCode) codes.add(result.primaryDeptCode)
    for (const dept of result.departments) {
      collectDeptCodes(dept, codes)
    }
    return {
      deptCodes: [...codes],
      managementDeptCodes: result.managedDeptCodes || []
    }
  } catch (error) {
    console.warn('[AimsTenantRuntime] failed to resolve current user departments:', error)
    return { deptCodes: [], managementDeptCodes: [] }
  }
}

function collectDeptCodes(dept: RuntimeDeptNode, codes: Set<string>) {
  const deptCode = String(dept.deptCode || '').trim()
  if (deptCode) codes.add(deptCode)
  for (const child of dept.children || []) {
    collectDeptCodes(child, codes)
  }
}

function isCrudPath(suffix: string, method: TenantRuntimeProxyContext['method'], resources: string[]) {
  for (const resource of resources) {
    if (suffix === resource) return method === 'GET' || method === 'POST'
    if (suffix.startsWith(`${resource}/`)) {
      const rest = suffix.slice(resource.length + 1).split('/').filter(Boolean)
      return rest.length === 1 && (method === 'GET' || method === 'PATCH' || method === 'PUT' || method === 'DELETE')
    }
  }
  return false
}

function isApiV1Path(pathname: string) {
  return Boolean(normalizedApiV1Path(pathname))
}

function normalizedApiV1Path(pathname: string) {
  const index = pathname.indexOf(API_PREFIX)
  if (index < 0) return ''

  const after = pathname[index + API_PREFIX.length] || ''
  if (after !== '' && after !== '/') return ''

  return pathname.slice(index)
}
