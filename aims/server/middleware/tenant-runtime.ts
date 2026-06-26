import { createError, getRequestURL, type H3Event } from 'h3'
import { maybeProxyCurrentApiToTenantRuntime, type TenantRuntimeProxyContext } from '@hzy/foundation/server/utils/tenantRuntimeProxy'
import { resolveConsoleAuthWithSessionBridge } from '@hzy/foundation/server/utils/consoleSessionBridge'
import { checkPermission, checkRole } from '~~/server/utils/checkPermission'
import { hasAimsSystemManageAccess } from '~~/server/utils/aimsAdminAccess'
import {
  checkAimsScopedPermission,
  resolveAimsProjectListAdminScopeQuery,
  resolveAimsProjectAuthorizationObject
} from '~~/server/utils/aimsScopedAuthorization'
import { fetchUserDepartments } from '~~/server/utils/userDepartments'
import { requireServiceScope } from '~~/server/utils/serviceAuth'

const APP_CODE = 'aims'
const API_PREFIX = '/api/v1'
const RUNTIME_RESOURCES = [
  '/admin/projects',
  '/approvals',
  '/deliverables',
  '/documents',
  '/milestones',
  '/portfolios',
  '/project-template-versions',
  '/projects',
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
  /^\/projects\/[^/]+\/time-entries\/[^/]+$/
]
const NUXT_ONLY_MARKERS = [
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
  /^\/api\/v1\/weekly-reports\/export$/,
  /^\/api\/v1\/project-documents\/accessible$/,
  /^\/api\/v1\/requirement-reviews\/[^/]+\/resolve$/,
  /^\/api\/v1\/product-assets$/,
  /^\/api\/v1\/projects\/[^/]+\/(markdown-documents|other-documents)$/,
  /^\/api\/v1\/projects\/[^/]+\/environments\/upsert$/,
  /^\/api\/v1\/projects\/[^/]+\/environments\/[^/]+:status$/,
  /^\/api\/v1\/projects\/[^/]+\/documents\/[^/]+\/(access-check|access-policy|access-audit|download)$/,
  /^\/api\/v1\/service\/products\/[^/]+\/versions$/,
  // 以下路径本地 handler 为 tenant-runtime 转发器（鉴权上下文 + 调用 runtime 专用端点）
  /^\/api\/v1\/requirements\/[^/]+\/create-task$/,
  /^\/api\/v1\/requirements\/[^/]+\/changes$/,
  /^\/api\/v1\/requirement-contents\/[^/]+\/restore$/,
  /^\/api\/v1\/projects\/[^/]+\/sync-gitlab$/
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

export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname
  if (isApiV1Path(pathname)) {
    await ensureConsoleAuthContext(event)
  }
  requireForwardedServiceCapability(event)

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
  if (isAdminProductVersionsReadPath(context.suffix, context.method)) return false
  if (isProductVersionRuntimePath(context.suffix, context.method)) return true
  if (isServiceContractRuntimePath(context.suffix, context.method)) return true

  if (context.method === 'GET' && /^\/work-items\/[^/]+\/breakdown-context$/.test(context.suffix)) return true
  if (context.method === 'GET' && /^\/work-items\/[^/]+\/(children|transitions|commits)$/.test(context.suffix)) return true
  if (context.method === 'GET' && /^\/milestones\/[^/]+\/detail$/.test(context.suffix)) return true
  if (context.method === 'GET' && context.suffix === '/projects/check-duplicate') return true

  if (context.suffix.startsWith('/codocs')) return false
  if (context.suffix.includes('codocs')) return false
  if (context.suffix.includes('/sync-gitlab')) return false
  if (context.method === 'GET' && NUXT_ONLY_GET_SUFFIX_PATTERNS.some(pattern => pattern.test(context.suffix))) return false
  if (NUXT_ONLY_MARKERS.some(marker => context.suffix.includes(marker))) return false

  if (/^\/projects\/[^/]+\/documents$/.test(context.suffix)) {
    return context.method === 'GET' || context.method === 'POST' || context.method === 'PUT' || context.method === 'PATCH'
  }
  if (/^\/projects\/[^/]+\/members$/.test(context.suffix)) {
    return context.method === 'GET' || context.method === 'POST' || context.method === 'DELETE'
  }
  if (RUNTIME_READONLY_COLLECTIONS.includes(context.suffix)) return context.method === 'GET'
  if (context.suffix === '/favorites') return context.method === 'GET' || context.method === 'POST'
  if (RUNTIME_NESTED_ITEM_RESOURCES.some(pattern => pattern.test(context.suffix))) {
    return context.method === 'PATCH' || context.method === 'PUT' || context.method === 'DELETE'
  }
  if (RUNTIME_NESTED_RESOURCES.some(pattern => pattern.test(context.suffix))) return context.method === 'GET' || context.method === 'POST'
  return isCrudPath(context.suffix, context.method, RUNTIME_RESOURCES)
}

function isServiceContractRuntimePath(suffix: string, method: TenantRuntimeProxyContext['method']) {
  if (/^\/service\/projects\/[^/]+\/environments$/.test(suffix)) return method === 'GET' || method === 'POST'
  if (/^\/service\/projects\/[^/]+\/environments\/[^/]+:(status|assets-sync|remove)$/.test(suffix)) return method === 'POST'
  if (/^\/service\/environments\/[^/]+\/projects$/.test(suffix)) return method === 'GET'
  if (suffix === '/service/projects/from-contract') return method === 'POST'
  if (suffix === '/service/projects/eligible-for-contract') return method === 'GET'
  if (/^\/service\/projects\/by-contract\/[^/]+$/.test(suffix)) return method === 'GET'
  if (/^\/service\/projects\/[^/]+\/payment-milestones:sync$/.test(suffix)) return method === 'POST'
  if (/^\/service\/service-tickets\/[^/]+\/work-item$/.test(suffix)) return method === 'POST'
  return false
}

interface ServiceCapabilityRequirement {
  scope: string
  allowedApps: string[]
}

function serviceCapabilityRequirement(suffix: string, method: string): ServiceCapabilityRequirement | null {
  if (method === 'GET' && /^\/service\/projects\/[^/]+\/environments$/.test(suffix)) {
    return { scope: 'aims:read', allowedApps: ['altoc', 'assets', 'finance', 'aims'] }
  }
  if (method === 'GET' && /^\/service\/environments\/[^/]+\/projects$/.test(suffix)) {
    return { scope: 'aims:read', allowedApps: ['altoc', 'assets', 'finance', 'aims'] }
  }
  if (method === 'GET' && /^\/service\/projects\/by-contract\/[^/]+$/.test(suffix)) {
    return { scope: 'aims:read', allowedApps: ['altoc', 'aims'] }
  }
  if (method === 'GET' && suffix === '/service/projects/eligible-for-contract') {
    return { scope: 'aims:read', allowedApps: ['altoc', 'aims'] }
  }
  if (method !== 'POST') return null

  if (suffix === '/service/projects/from-contract') {
    return { scope: 'aims:write', allowedApps: ['altoc'] }
  }
  if (/^\/service\/projects\/[^/]+\/environments$/.test(suffix)) {
    return { scope: 'aims:write', allowedApps: ['assets', 'altoc', 'aims'] }
  }
  if (/^\/service\/projects\/[^/]+\/environments\/[^/]+:(status|assets-sync|remove)$/.test(suffix)) {
    return { scope: 'aims:write', allowedApps: ['assets', 'altoc', 'aims'] }
  }
  if (/^\/service\/projects\/[^/]+\/payment-milestones:sync$/.test(suffix)) {
    return { scope: 'aims:write', allowedApps: ['altoc', 'aims'] }
  }
  if (/^\/service\/service-tickets\/[^/]+\/work-item$/.test(suffix)) {
    return { scope: 'aims:write', allowedApps: ['altoc'] }
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
  if (!requirement) return

  requireServiceScope(event, requirement)
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
  const suffix = apiPath.slice(API_PREFIX.length) || '/'

  if (String(method || 'GET').toUpperCase() === 'GET' && NUXT_ONLY_GET_PATTERNS.some(pattern => pattern.test(apiPath))) return true
  if (NUXT_ONLY_PATTERNS.some(pattern => pattern.test(apiPath))) return true
  if (NUXT_ONLY_MARKERS.some(marker => suffix.includes(marker))) return true
  return apiPath.endsWith('/api/v1/codocs/department-documents')
    || apiPath.endsWith('/api/v1/codocs/project-documents')
    || apiPath.includes('/api/v1/codocs/documents/')
}

function scopeFor(context: TenantRuntimeProxyContext) {
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
  delete sanitizedQuery.current_user_can_view_weekly_report_summary
  delete sanitizedQuery.currentUserCanViewWeeklyReportSummary

  if (context.method === 'GET' && context.suffix === '/weekly-reports/export-data' && !await hasWeeklyReportRuntimeAccess(context)) {
    throw createError({ statusCode: 403, message: '权限不足' })
  }

  if (needsWeeklyReportSummaryViewContext(context)) {
    sanitizedQuery.current_user_can_view_weekly_report_summary = context.method === 'GET' && context.suffix === '/weekly-reports'
      ? '1'
      : await hasWeeklyReportRuntimeAccess(context) ? '1' : '0'
  }
  if (needsProjectAdminContext(context)) {
    sanitizedQuery.current_user_is_project_admin = await hasWeeklyReportManageAccess(context.event) ? '1' : '0'
  }
  if (needsProductAdminContext(context)) {
    sanitizedQuery.current_user_is_project_admin = await hasAimsSystemManageAccess(context.event) ? '1' : '0'
  }
  if (needsProjectObjectAdminContext(context)) {
    const hasProjectObjectAdmin = await hasProjectObjectAdminAccess(context)
    sanitizedQuery.current_user_is_project_admin = sanitizedQuery.current_user_is_project_admin === '1' || hasProjectObjectAdmin ? '1' : '0'
  }

  if (!needsProjectVisibilityContext(context)) return sanitizedQuery

  const visibilityContext = await resolveCurrentUserProjectVisibilityContext(context.currentUser)
  if (visibilityContext.deptCodes.length > 0) {
    sanitizedQuery.current_user_dept_codes = visibilityContext.deptCodes.join(',')
  }
  if (visibilityContext.managementDeptCodes.length > 0) {
    sanitizedQuery.current_user_management_dept_codes = visibilityContext.managementDeptCodes.join(',')
  }
  if (context.method === 'GET' && context.suffix === '/projects') {
    Object.assign(sanitizedQuery, await resolveAimsProjectListAdminScopeQuery(context.event, context.currentUser, visibilityContext))
  }
  return sanitizedQuery
}

function needsProjectVisibilityContext(context: TenantRuntimeProxyContext) {
  return context.method === 'GET'
    && (
      context.suffix === '/projects'
      || /^\/projects\/[^/]+$/.test(context.suffix)
      || /^\/projects\/[^/]+\/members$/.test(context.suffix)
      || /^\/projects\/[^/]+\/documents$/.test(context.suffix)
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
  if (/^\/projects\/[^/]+\/weekly-reports$/.test(context.suffix)) {
    return context.method === 'GET' || context.method === 'POST'
  }
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

function needsProjectAdminContext(context: TenantRuntimeProxyContext) {
  return /^\/projects\/[^/]+\/weekly-reports$/.test(context.suffix)
}

function needsProductAdminContext(context: TenantRuntimeProxyContext) {
  return /^\/admin\/products\/[^/]+\/versions$/.test(context.suffix)
    || /^\/admin\/product-versions\/[^/]+(\/transition)?$/.test(context.suffix)
    || /^\/admin\/product-versions\/[^/]+\/features(\/[^/]+)?$/.test(context.suffix)
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
  return await hasAimsSystemManageAccess(event)
    || await checkPermission(event, 'reports', 'edit')
    || await checkPermission(event, 'reports', 'admin')
}

async function hasWeeklyReportRuntimeAccess(context: TenantRuntimeProxyContext) {
  if (context.method === 'GET' && context.suffix === '/weekly-reports/export-data') {
    return await checkPermission(context.event, 'reports', 'export')
  }

  if (
    context.method === 'GET'
    && context.suffix === '/weekly-reports'
  ) {
    return await checkPermission(context.event, 'reports', 'view')
      || await checkPermission(context.event, 'projects', 'admin')
      || await checkPermission(context.event, 'project_templates', 'admin')
      || await checkPermission(context.event, 'admin', 'admin')
      || await checkRole(context.event, 'aims:admin')
      || await checkRole(context.event, 'console:admin')
      || await checkRole(context.event, 'console:console-dev-admin')
  }

  return await hasWeeklyReportManageAccess(context.event)
}

async function hasProjectObjectAdminAccess(context: TenantRuntimeProxyContext) {
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

  const visibilityContext = await resolveCurrentUserProjectVisibilityContext(context.currentUser)
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

async function resolveCurrentUserProjectVisibilityContext(uid: string) {
  const normalizedUid = String(uid || '').trim()
  if (!normalizedUid) return { deptCodes: [], managementDeptCodes: [] }

  try {
    const result = await fetchUserDepartments(normalizedUid)
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
